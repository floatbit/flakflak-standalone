<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class InteractionController extends Controller
{
    public static function participant(Request $r, string $site): ?object
    {
        return $r->attributes->get('participant');
    }

    private function comment(string $site, string $comment, bool $lock = false): object
    {
        $query = DB::table('comments')->where('site_id', $site)->where('id', $comment);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->firstOrFail();
    }

    private function owner(Request $r, object $item): void
    {
        abort_unless(($item->participant_id === $r->attributes->get('participant')->id || $r->attributes->get('membership')?->role === 'owner'), 403, 'Only the contributor can change this item.');
    }

    private function event(string $site, int $comment, string $participant, string $type, string $summary): void
    {
        DB::table('activity')->insert(['site_id' => $site, 'comment_id' => $comment, 'participant_id' => $participant, 'type' => $type, 'summary' => $summary, 'created_at' => now()]);
    }

    public function update(Request $r, string $site, string $comment)
    {
        $v = $r->validate(['body' => 'required|string|max:10000', 'version' => 'required|integer|min:1']);
        DB::transaction(function () use ($r, $site, $comment, $v) {
            $c = $this->comment($site, $comment, true);
            $this->owner($r, $c);
            abort_unless((int) $c->version === (int) $v['version'], 409, 'This comment changed. Refresh before editing.');
            DB::table('comments')->where('id', $comment)->update(['body' => $v['body'], 'version' => $c->version + 1, 'updated_at' => now()]);
            $this->event($site, (int) $comment, $r->attributes->get('participant')->id, 'edit', 'Edited the comment');
        });

        return app(FeedbackController::class)->detail($r, $site, $comment);
    }

    public function move(Request $r, string $site, string $comment)
    {
        $v = $r->validate(['version' => 'required|integer|min:1', 'anchor' => 'required|array:selector,text,x,y,documentX,documentY,viewportWidth', 'anchor.selector' => 'required|string|max:1500', 'anchor.text' => 'nullable|string|max:160', 'anchor.x' => 'required|numeric|between:0,1', 'anchor.y' => 'required|numeric|between:0,1', 'anchor.documentX' => 'required|numeric|min:0', 'anchor.documentY' => 'required|numeric|min:0', 'anchor.viewportWidth' => 'required|numeric|min:1']);
        DB::transaction(function () use ($r, $site, $comment, $v) {
            $c = $this->comment($site, $comment, true);
            abort_unless((int) $c->version === (int) $v['version'], 409, 'This comment changed. Refresh before moving it.');
            DB::table('comments')->where('id', $comment)->update(['anchor' => json_encode($v['anchor']), 'version' => $c->version + 1, 'updated_at' => now()]);
            $this->event($site, (int) $comment, $r->attributes->get('participant')->id, 'move', 'Moved the comment target');
        });

        return app(FeedbackController::class)->detail($r, $site, $comment);
    }

    public function delete(Request $r, string $site, string $comment)
    {
        $paths = DB::transaction(function () use ($r, $site, $comment) {
            $c = $this->comment($site, $comment, true);
            $this->owner($r, $c);
            $files = DB::table('attachments')->where('comment_id', $comment)->pluck('path');
            DB::table('comments')->where('id', $comment)->delete();

            return $files;
        });
        foreach ($paths as $path) {
            if (! Storage::disk('local')->delete($path)) {
                Log::warning('FlakFlak: private attachment cleanup failed', ['path' => $path]);
            }
        }

        return response()->json(['deleted' => true]);
    }

    public function deleteReply(Request $r, string $site, string $comment, string $reply)
    {
        $this->comment($site, $comment);
        $row = DB::table('replies')->where('comment_id', $comment)->where('id', $reply)->firstOrFail();
        $this->owner($r, $row);
        abort_unless($row->kind === 'reply', 403, 'Status history cannot be deleted as a reply.');
        DB::table('activity')->where('site_id', $site)->where('comment_id', $comment)->where('participant_id', $row->participant_id)->where('type', 'reply')->where('summary', $row->body)->where('created_at', $row->created_at)->delete();
        DB::table('replies')->where('id', $reply)->delete();

        return app(FeedbackController::class)->detail($r, $site, $comment);
    }

    public function deleteAttachment(Request $r, string $site, string $comment, string $attachment)
    {
        $this->comment($site, $comment);
        $row = DB::table('attachments')->where('comment_id', $comment)->where('id', $attachment)->firstOrFail();
        $this->owner($r, $row);
        abort_unless(! Storage::disk('local')->exists($row->path) || Storage::disk('local')->delete($row->path), 500, 'Could not remove the file. Please retry.');
        DB::table('attachments')->where('id', $attachment)->delete();

        return app(FeedbackController::class)->detail($r, $site, $comment);
    }

    public function replies(Request $r, string $site, string $comment)
    {
        $this->comment($site, $comment);
        $v = $r->validate(['before' => 'required|integer|min:1']);
        $rows = DB::table('replies')->join('participants', 'participants.id', '=', 'replies.participant_id')->where('comment_id', $comment)->where('replies.id', '<', $v['before'])->orderByDesc('replies.id')->limit(21)->get(['replies.id', 'replies.participant_id', 'participants.name', 'replies.body', 'replies.kind', 'replies.created_at']);
        $batch = $rows->take(20)->reverse()->values();

        return ['replies' => $batch, 'more' => $rows->count() > 20, 'before' => $batch->first()?->id];
    }

    public function markRead(Request $r, string $site)
    {
        $v = $r->validate(['items' => 'required|array|max:100', 'items.*.id' => 'required|integer|min:1', 'items.*.activity_id' => 'required|integer|min:0']);
        $person = $r->attributes->get('participant');
        $saved = [];
        DB::transaction(function () use ($v, $person, $site, &$saved) {
            foreach ($v['items'] as $item) {
                $comment = DB::table('comments')->where('site_id', $site)->where('id', $item['id'])->first();
                if (! $comment) {
                    continue;
                }
                $latest = (int) DB::table('activity')->where('site_id', $site)->where('comment_id', $item['id'])->max('id');
                $requested = min($latest, (int) $item['activity_id']);
                DB::table('read_states')->insertOrIgnore(['participant_id' => $person->id, 'comment_id' => $item['id'], 'activity_id' => 0]);
                $query = DB::table('read_states')->where('participant_id', $person->id)->where('comment_id', $item['id']);
                $previous = $query->lockForUpdate()->first();
                $cursor = max((int) $previous->activity_id, $requested);
                $query->update(['activity_id' => $cursor]);
                $saved[] = ['id' => $item['id'], 'activity_id' => $cursor];
            }
        });

        return ['items' => $saved];
    }
}
