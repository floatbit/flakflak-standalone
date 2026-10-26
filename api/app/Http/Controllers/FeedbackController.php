<?php

namespace App\Http\Controllers;

use App\Support\PageUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class FeedbackController extends Controller
{
    public function health()
    {
        DB::select('SELECT 1');

        return ['status' => 'ok', 'api_version' => 'v1'];
    }

    public function sites()
    {
        return DB::table('sites')->orderBy('created_at', 'desc')->get()->map(fn ($s) => $this->siteData($s));
    }

    private function siteData($s): array
    {
        return ['id' => $s->id, 'name' => $s->name, 'origins' => json_decode($s->origins, true), 'embed_url' => config('flakflak.embed_url')];
    }

    public function createSite(Request $r)
    {
        $v = $r->validate(['name' => 'required|string|max:100', 'origins' => 'required|array|min:1|max:20', 'origins.*' => 'required|string|max:500']);
        $origins = array_values(array_unique(array_map(fn ($o) => PageUrl::origin($o), $v['origins'])));
        $id = (string) Str::uuid();
        DB::table('sites')->insert(['id' => $id, 'name' => $v['name'], 'origins' => json_encode($origins), 'created_at' => now(), 'updated_at' => now()]);

        return response()->json($this->siteData(DB::table('sites')->find($id)), 201);
    }

    public function site(Request $r)
    {
        return $this->siteData($r->attributes->get('site'));
    }

    public function guest(Request $r, string $site)
    {
        $v = $r->validate(['name' => 'required|string|max:100']);
        $token = Str::random(64);
        $id = (string) Str::uuid();
        DB::table('participants')->insert(['id' => $id, 'site_id' => $site, 'name' => $v['name'], 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addDays(90), 'created_at' => now(), 'updated_at' => now()]);

        return response()->json(['id' => $id, 'name' => $v['name'], 'token' => $token, 'expires_at' => now()->addDays(90)->toISOString()], 201);
    }

    private function pageUrl(Request $r, string $url): string
    {
        $canonical = PageUrl::canonical($url);
        abort_unless(PageUrl::origin($canonical) === PageUrl::origin($r->header('Origin')), 422, 'The page URL must match the requesting origin.');

        return $canonical;
    }

    private function thread(string $site, string $id)
    {
        return DB::table('comments')->where('site_id', $site)->where('id', $id)->firstOrFail();
    }

    private function event(string $site, int $comment, string $participant, string $type, string $summary): void
    {
        DB::table('activity')->insert(['site_id' => $site, 'comment_id' => $comment, 'participant_id' => $participant, 'type' => $type, 'summary' => $summary, 'created_at' => now()]);
    }

    private function commentData($c): array
    {
        return ['id' => $c->id, 'page_id' => $c->page_id, 'participant_id' => $c->participant_id, 'name' => $c->author_name ?? DB::table('participants')->where('id', $c->participant_id)->value('name'),
            'body' => $c->body, 'status' => $c->status, 'anchor' => json_decode($c->anchor, true), 'version' => $c->version, 'created_at' => $c->created_at];
    }

    public function comments(Request $r, string $site)
    {
        $r->validate(['url' => 'required|string|max:2000', 'before' => 'nullable|integer|min:1']);
        $url = $this->pageUrl($r, $r->input('url'));
        $page = DB::table('pages')->where('site_id', $site)->where('url_hash', hash('sha256', $url))->first();
        if (! $page) {
            return ['comments' => [], 'more' => false, 'before' => null];
        }
        $q = DB::table('comments')->leftJoin('participants as author', 'author.id', '=', 'comments.participant_id')->where('comments.site_id', $site)->where('comments.page_id', $page->id)->select('comments.*', 'author.name as author_name');
        if ($r->input('before')) {
            $q->where('comments.id', '<', $r->integer('before'));
        }
        $rows = $q->orderByDesc('comments.id')->limit(101)->get();
        $more = $rows->count() > 100;
        $rows = $rows->take(100);

        $person = InteractionController::participant($r, $site);
        $ids = $rows->pluck('id');
        $latest = DB::table('activity')->where('site_id', $site)->whereIn('comment_id', $ids)->groupBy('comment_id')->selectRaw('comment_id,MAX(id) as latest')->pluck('latest', 'comment_id');
        $other = DB::table('activity')->where('site_id', $site)->whereIn('comment_id', $ids);
        if ($person) {
            $other->where('participant_id', '!=', $person->id);
        }
        $other = $other->groupBy('comment_id')->selectRaw('comment_id,MAX(id) as latest')->pluck('latest', 'comment_id');
        $read = $person ? DB::table('read_states')->where('participant_id', $person->id)->whereIn('comment_id', $ids)->pluck('activity_id', 'comment_id') : collect();

        return ['comments' => $rows->map(fn ($c) => array_merge($this->commentData($c), ['latest_activity_id' => (int) ($latest[$c->id] ?? 0), 'unread' => (int) ($other[$c->id] ?? 0) > (int) ($read[$c->id] ?? 0)]))->values(), 'more' => $more, 'before' => $rows->last()?->id];
    }

    public function createComment(Request $r, string $site)
    {
        $v = $r->validate(['url' => 'required|string|max:2000', 'title' => 'required|string|max:255', 'body' => 'required|string|max:10000', 'status' => ['required', Rule::in(['open', 'content'])],
            'client_id' => 'required|uuid', 'anchor' => 'required|array:selector,text,x,y,documentX,documentY,viewportWidth',
            'anchor.selector' => 'required|string|max:1500', 'anchor.text' => 'nullable|string|max:160', 'anchor.x' => 'required|numeric|between:0,1', 'anchor.y' => 'required|numeric|between:0,1',
            'anchor.documentX' => 'required|numeric|min:0', 'anchor.documentY' => 'required|numeric|min:0', 'anchor.viewportWidth' => 'required|numeric|min:1']);
        $url = $this->pageUrl($r, $v['url']);
        $person = $r->attributes->get('participant');
        $id = DB::transaction(function () use ($site, $v, $url, $person) {
            $existing = DB::table('comments')->where('site_id', $site)->where('client_id', $v['client_id'])->first();
            if ($existing) {
                abort_unless($existing->participant_id === $person->id, 409);

                return $existing->id;
            }
            DB::table('pages')->insertOrIgnore(['site_id' => $site, 'url' => $url, 'url_hash' => hash('sha256', $url), 'title' => $v['title'], 'created_at' => now(), 'updated_at' => now()]);
            $page = DB::table('pages')->where('site_id', $site)->where('url_hash', hash('sha256', $url))->first();
            $id = DB::table('comments')->insertGetId(['site_id' => $site, 'page_id' => $page->id, 'participant_id' => $person->id, 'client_id' => $v['client_id'], 'body' => $v['body'], 'status' => $v['status'], 'anchor' => json_encode($v['anchor']), 'created_at' => now(), 'updated_at' => now()]);
            $this->event($site, $id, $person->id, 'comment', 'Added a comment');

            return $id;
        });

        return response()->json($this->commentData($this->thread($site, (string) $id)), 201);
    }

    public function detail(Request $r, string $site, string $comment)
    {
        // Capture the read watermark before fetching content so concurrent arrivals stay unread.
        $snapshot = (int) DB::table('activity')->where('site_id', $site)->where('comment_id', $comment)->max('id');
        $c = $this->thread($site, $comment);
        $query = DB::table('replies')->join('participants', 'participants.id', '=', 'replies.participant_id')->where('comment_id', $c->id);
        $count = (clone $query)->count();
        if ($r->integer('reply_limit') === 2) {
            $query->limit(2);
        }
        $replies = $query->orderByDesc('replies.id')->get(['replies.id', 'replies.participant_id', 'participants.name', 'replies.body', 'replies.kind', 'replies.created_at'])->reverse()->values();
        $files = DB::table('attachments')->where('comment_id', $c->id)->get()->map(fn ($f) => ['id' => $f->id, 'name' => $f->name, 'mime' => $f->mime, 'size' => $f->size, 'participant_id' => $f->participant_id, 'url' => URL::temporarySignedRoute('attachment', now()->addHours(2), ['attachment' => $f->id])]);

        return ['comment' => $this->commentData($c), 'replies' => $replies, 'reply_count' => $count, 'reply_before' => $count > $replies->count() ? $replies->first()?->id : null, 'latest_activity_id' => $snapshot, 'attachments' => $files];
    }

    public function reply(Request $r, string $site, string $comment)
    {
        $this->thread($site, $comment);
        $v = $r->validate(['body' => 'required|string|max:10000', 'client_id' => 'required|uuid']);
        $p = $r->attributes->get('participant');
        DB::transaction(function () use ($site, $comment, $v, $p) {
            $existing = DB::table('replies')->where('comment_id', $comment)->where('client_id', $v['client_id'])->first();
            if ($existing) {
                abort_unless($existing->participant_id === $p->id, 409);

                return;
            }
            DB::table('replies')->insert(['comment_id' => $comment, 'participant_id' => $p->id, 'client_id' => $v['client_id'], 'body' => $v['body'], 'created_at' => now(), 'updated_at' => now()]);
            $this->event($site, (int) $comment, $p->id, 'reply', $v['body']);
        });

        return $this->detail($r, $site, $comment);
    }

    public function status(Request $r, string $site, string $comment)
    {
        $v = $r->validate(['status' => ['required', Rule::in(['open', 'review', 'content', 'closed'])], 'version' => 'required|integer|min:1', 'note' => 'nullable|string|max:10000']);
        $p = $r->attributes->get('participant');
        DB::transaction(function () use ($site, $comment, $v, $p) {
            $c = DB::table('comments')->where('site_id', $site)->where('id', $comment)->lockForUpdate()->firstOrFail();
            abort_unless($c->version === $v['version'], 409, 'This comment changed. Refresh it before trying again.');
            if ($c->status === $v['status']) {
                return;
            }
            DB::table('comments')->where('id', $comment)->update(['status' => $v['status'], 'version' => $c->version + 1, 'updated_at' => now()]);
            $note = $v['status'] === 'closed' ? trim($v['note'] ?? '') : '';
            $summary = 'Status updated to '.$v['status'].($note !== '' ? '. Resolution note: '.$note : '.');
            DB::table('replies')->insert(['comment_id' => $comment, 'participant_id' => $p->id, 'client_id' => (string) Str::uuid(), 'body' => $summary, 'kind' => 'status', 'created_at' => now(), 'updated_at' => now()]);
            $this->event($site, (int) $comment, $p->id, $note !== '' ? 'resolution' : 'status', $summary);
        });

        return $this->detail($r, $site, $comment);
    }

    public function upload(Request $r, string $site, string $comment)
    {
        $this->thread($site, $comment);
        $v = $r->validate(['file' => 'required|file|mimetypes:image/jpeg,image/png,image/webp,image/gif,video/mp4|max:10240', 'client_id' => 'required|uuid']);
        $p = $r->attributes->get('participant');
        $existing = DB::table('attachments')->where('comment_id', $comment)->where('client_id', $v['client_id'])->first();
        if ($existing) {
            abort_unless($existing->participant_id === $p->id, 409);

            return $this->detail($r, $site, $comment);
        }
        abort_if(DB::table('attachments')->where('comment_id', $comment)->count() >= 20, 422, 'Maximum 20 attachments per comment.');
        $file = $r->file('file');
        $path = $file->store('attachments/'.$site, 'local');
        abort_unless($path, 500, 'Upload failed.');
        try {
            DB::table('attachments')->insert(['comment_id' => $comment, 'participant_id' => $p->id, 'client_id' => $v['client_id'], 'path' => $path, 'name' => mb_substr(basename($file->getClientOriginalName()), 0, 240), 'mime' => $file->getMimeType(), 'size' => $file->getSize(), 'created_at' => now(), 'updated_at' => now()]);
        } catch (\Throwable $e) {
            Storage::disk('local')->delete($path);
            throw $e;
        }

        return $this->detail($r, $site, $comment);
    }

    public function attachment(string $attachment)
    {
        $f = DB::table('attachments')->find($attachment);
        abort_unless($f && Storage::disk('local')->exists($f->path), 404);

        return response()->file(Storage::disk('local')->path($f->path), ['Content-Type' => $f->mime, 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, max-age=300', 'Content-Security-Policy' => "default-src 'none'; media-src 'self'; sandbox"]);
    }

    public function pages(string $site)
    {
        $counts = DB::table('comments')->where('site_id', $site)->groupBy('page_id', 'status')->selectRaw('page_id,status,COUNT(*) as count')->get();
        $byPage = [];
        foreach ($counts as $row) {
            $byPage[$row->page_id][$row->status] = (int) $row->count;
        }

        return DB::table('pages')->where('site_id', $site)->whereIn('id', array_keys($byPage))->orderBy('title')->get()->map(fn ($page) => ['id' => $page->id, 'title' => $page->title, 'url' => $page->url, 'counts' => $byPage[$page->id]]);
    }

    public function search(Request $r, string $site)
    {
        $v = $r->validate(['query' => 'required|string|min:1|max:200', 'page' => 'nullable|integer|min:1|max:10000']);
        $term = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], trim($v['query'])).'%';
        $q = DB::table('comments')->join('pages', 'pages.id', '=', 'comments.page_id')->join('participants', 'participants.id', '=', 'comments.participant_id')->where('comments.site_id', $site)
            ->where(function ($q) use ($term, $v) {
                $q->whereRaw("comments.body LIKE ? ESCAPE '!'", [$term])->orWhereRaw("participants.name LIKE ? ESCAPE '!'", [$term])->orWhereRaw("pages.title LIKE ? ESCAPE '!'", [$term]);
                if (ctype_digit(ltrim($v['query'], '#'))) {
                    $q->orWhere('comments.id', (int) ltrim($v['query'], '#'));
                }
                $q->orWhereExists(function ($sub) use ($term) {
                    $sub->selectRaw('1')->from('replies')->whereColumn('replies.comment_id', 'comments.id')->whereRaw("replies.body LIKE ? ESCAPE '!'", [$term]);
                });
            });
        $count = (clone $q)->count();
        $page = $r->integer('page', 1);

        return ['results' => $q->orderByDesc('comments.id')->offset(($page - 1) * 20)->limit(20)->get(['comments.id', 'comments.body', 'comments.status', 'participants.name', 'pages.title', 'pages.url']), 'more' => $count > $page * 20, 'total' => $count];
    }

    public function updateSite(Request $r, string $site)
    {
        $v = $r->validate(['name' => 'required|string|max:100', 'origins' => 'required|array|min:1|max:20', 'origins.*' => 'required|string|max:500']);
        abort_unless(DB::table('sites')->where('id', $site)->exists(), 404);
        DB::table('sites')->where('id', $site)->update(['name' => $v['name'], 'origins' => json_encode(array_values(array_unique(array_map(fn ($o) => PageUrl::origin($o), $v['origins'])))), 'updated_at' => now()]);

        return $this->siteData(DB::table('sites')->find($site));
    }

    public function activity(Request $r, string $site)
    {
        $r->validate(['before' => 'nullable|integer|min:1']);
        $person = InteractionController::participant($r, $site);
        $q = DB::table('activity')->join('participants', 'participants.id', '=', 'activity.participant_id')->join('comments', 'comments.id', '=', 'activity.comment_id')->join('pages', 'pages.id', '=', 'comments.page_id')->where('activity.site_id', $site);
        if ($person) {
            $q->leftJoin('read_states', function ($join) use ($person) {
                $join->on('read_states.comment_id', '=', 'activity.comment_id')->where('read_states.participant_id', '=', $person->id);
            });
            $q->selectRaw('CASE WHEN activity.participant_id = ? THEN 0 WHEN activity.id > COALESCE(read_states.activity_id,0) THEN 1 ELSE 0 END as unread', [$person->id]);
            if ($r->boolean('unread_only')) {
                $q->where('activity.participant_id', '!=', $person->id)->where(function ($q) {
                    $q->whereNull('read_states.activity_id')->orWhereColumn('activity.id', '>', 'read_states.activity_id');
                });
            }
        } else {
            $q->selectRaw('1 as unread');
        }
        if ($r->input('before')) {
            $q->where('activity.id', '<', $r->integer('before'));
        }
        $rows = $q->orderByDesc('activity.id')->limit(21)->addSelect(['activity.id', 'activity.comment_id', 'participants.name', 'activity.type', 'activity.summary', 'comments.body as comment_body', 'activity.created_at', 'pages.title', 'pages.url'])->get();

        return ['events' => $rows->take(20)->map(function ($row) {
            $row->unread = (bool) $row->unread;

            return $row;
        })->values(), 'more' => $rows->count() > 20, 'before' => $rows->take(20)->last()?->id];
    }
}
