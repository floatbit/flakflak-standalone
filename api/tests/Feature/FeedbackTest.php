<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackTest extends TestCase
{
    use RefreshDatabase;

    private string $owner = 'test-owner-key-at-least-thirty-two-characters-long';

    protected function setUp(): void
    {
        parent::setUp();
        config(['flakflak.owner_key' => $this->owner, 'flakflak.dashboard_origin' => 'http://dashboard.test']);
    }

    private function site(): string
    {
        return $this->withToken($this->owner)->withHeader('Origin', 'http://dashboard.test')->postJson('/api/v1/sites', ['name' => 'Test', 'origins' => ['http://review.test', 'http://second.test']])->assertCreated()->json('id');
    }

    private function guest(string $site, string $name = 'Chris'): array
    {
        return $this->withToken('')->withHeader('Origin', 'http://review.test')->postJson('/api/v1/sites/'.$site.'/guests', ['name' => $name])->assertCreated()->json();
    }

    private function comment(string $site, array $g, ?string $uuid = null): array
    {
        return $this->withToken($g['token'])->withHeader('Origin', 'http://review.test')->postJson('/api/v1/sites/'.$site.'/comments', ['url' => 'http://review.test/about?utm_source=email#section', 'title' => 'About', 'body' => 'Improve this text', 'status' => 'open', 'client_id' => $uuid ?? (string) Str::uuid(), 'anchor' => ['selector' => '#intro', 'text' => 'Intro', 'x' => 0.2, 'y' => 0.5, 'documentX' => 100, 'documentY' => 200, 'viewportWidth' => 1200]])->assertCreated()->json();
    }

    public function test_owner_key_is_required_and_never_returned(): void
    {
        $this->getJson('/api/v1/sites')->assertUnauthorized();
        $s = $this->site();
        $this->withToken($this->owner)->getJson('/api/v1/sites')->assertOk()->assertJsonMissing(['token' => $this->owner]);
        $this->withHeader('Origin', 'http://evil.test')->withToken('')->getJson('/api/v1/sites/'.$s.'/config')->assertForbidden();
    }

    public function test_guest_names_do_not_grant_ownership_and_tokens_are_site_scoped(): void
    {
        $a = $this->site();
        $b = $this->site();
        $one = $this->guest($a);
        $two = $this->guest($a);
        $this->assertNotSame($one['id'], $two['id']);
        $this->assertNotSame($one['token'], $two['token']);
        $this->withToken($one['token'])->postJson('/api/v1/sites/'.$b.'/comments', [])->assertUnauthorized();
        $this->assertDatabaseMissing('participants', ['token_hash' => $one['token']]);
    }

    public function test_comments_are_idempotent_and_urls_are_canonical(): void
    {
        $s = $this->site();
        $g = $this->guest($s);
        $uuid = (string) Str::uuid();
        $a = $this->comment($s, $g, $uuid);
        $b = $this->comment($s, $g, $uuid);
        $this->assertSame($a['id'], $b['id']);
        $this->assertDatabaseCount('comments', 1);
        $this->assertDatabaseCount('activity', 1);
        $this->assertDatabaseHas('pages', ['url' => 'http://review.test/about']);
        $this->getJson('/api/v1/sites/'.$s.'/comments?url='.urlencode('http://review.test/about'))->assertOk()->assertJsonCount(1, 'comments');
        $this->getJson('/api/v1/sites/'.$s.'/comments?url='.urlencode('http://second.test/about'))->assertUnprocessable();
    }

    public function test_replies_status_resolution_and_conflict_handling(): void
    {
        $s = $this->site();
        $g = $this->guest($s);
        $c = $this->comment($s, $g);
        $path = '/api/v1/sites/'.$s.'/comments/'.$c['id'];
        $uuid = (string) Str::uuid();
        $this->postJson($path.'/replies', ['body' => 'Reply', 'client_id' => $uuid])->assertOk()->assertJsonCount(1, 'replies');
        $this->postJson($path.'/replies', ['body' => 'Reply', 'client_id' => $uuid])->assertOk()->assertJsonCount(1, 'replies');
        $this->patchJson($path.'/status', ['status' => 'closed', 'version' => 1, 'note' => 'Fixed the footer'])->assertOk()->assertJsonPath('comment.status', 'closed')->assertJsonPath('comment.version', 2);
        $this->patchJson($path.'/status', ['status' => 'review', 'version' => 1])->assertConflict();
        $this->assertDatabaseHas('activity', ['type' => 'resolution']);
        $this->assertDatabaseCount('replies', 2);
    }

    public function test_a_thread_cannot_be_read_or_changed_through_another_site(): void
    {
        $a = $this->site();
        $g = $this->guest($a);
        $c = $this->comment($a, $g);
        $b = $this->site();
        $h = $this->guest($b);
        $this->withToken($h['token'])->getJson('/api/v1/sites/'.$b.'/comments/'.$c['id'])->assertNotFound();
        $this->patchJson('/api/v1/sites/'.$b.'/comments/'.$c['id'].'/status', ['status' => 'closed', 'version' => 1])->assertNotFound();
    }

    public function test_upload_validation_idempotency_and_signed_access(): void
    {
        Storage::fake('local');
        $s = $this->site();
        $g = $this->guest($s);
        $c = $this->comment($s, $g);
        $path = '/api/v1/sites/'.$s.'/comments/'.$c['id'].'/attachments';
        $uuid = (string) Str::uuid();
        $response = $this->postJson($path, ['client_id' => $uuid, 'file' => UploadedFile::fake()->image('screen.png')])->assertOk();
        $url = $response->json('attachments.0.url');
        $this->postJson($path, ['client_id' => $uuid, 'file' => UploadedFile::fake()->image('screen.png')])->assertOk();
        $this->assertDatabaseCount('attachments', 1);
        $this->get($url)->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->get('/api/attachments/1')->assertForbidden();
        $this->postJson($path, ['client_id' => (string) Str::uuid(), 'file' => UploadedFile::fake()->create('bad.svg', 1, 'image/svg+xml')])->assertUnprocessable();
    }

    public function test_page_and_activity_lists_stay_inside_the_site(): void
    {
        $a = $this->site();
        $g = $this->guest($a);
        $this->comment($a, $g);
        $b = $this->site();
        $this->guest($b);
        $this->getJson('/api/v1/sites/'.$b.'/pages')->assertOk()->assertExactJson([]);
        $this->getJson('/api/v1/sites/'.$b.'/activity')->assertOk()->assertJsonCount(0, 'events');
        $this->getJson('/api/v1/sites/'.$a.'/activity')->assertOk()->assertJsonCount(1, 'events');
    }

    public function test_site_settings_and_search(): void
    {
        $s = $this->site();
        $g = $this->guest($s);
        $c = $this->comment($s, $g);
        $this->getJson('/api/v1/sites/'.$s.'/search?query=Improve')->assertOk()->assertJsonPath('results.0.id', $c['id']);
        $this->getJson('/api/v1/sites/'.$s.'/search?query=unmatched')->assertOk()->assertJsonCount(0, 'results');
        $this->withToken($g['token'])->patchJson('/api/v1/sites/'.$s, ['name' => 'Changed', 'origins' => ['http://review.test']])->assertUnauthorized();
        $this->withToken($this->owner)->withHeader('Origin', 'http://dashboard.test')->patchJson('/api/v1/sites/'.$s, ['name' => 'Changed', 'origins' => ['https://new.example/path']])->assertOk()->assertJsonPath('origins.0', 'https://new.example');
    }

    public function test_read_cursors_are_monotonic_and_own_actions_are_not_unread(): void
    {
        $site = $this->site();
        $author = $this->guest($site);
        $comment = $this->comment($site, $author);
        $reader = $this->guest($site, 'Reader');
        $path = '/api/v1/sites/'.$site;
        $this->withToken($reader['token'])->getJson($path.'/comments?url='.urlencode('http://review.test/about'))->assertJsonPath('comments.0.unread', true);
        $snapshot = $this->getJson($path.'/comments/'.$comment['id'])->json('latest_activity_id');
        $this->postJson($path.'/read', ['items' => [['id' => $comment['id'], 'activity_id' => $snapshot]]])->assertOk();
        $this->getJson($path.'/comments?url='.urlencode('http://review.test/about'))->assertJsonPath('comments.0.unread', false);
        $this->postJson($path.'/comments/'.$comment['id'].'/replies', ['body' => 'My own reply', 'client_id' => (string) Str::uuid()])->assertOk();
        $this->getJson($path.'/activity?unread_only=true')->assertJsonCount(0, 'events');
        $this->withToken($author['token'])->postJson($path.'/comments/'.$comment['id'].'/replies', ['body' => 'New reply from author', 'client_id' => (string) Str::uuid()])->assertOk();
        $this->withToken($reader['token'])->postJson($path.'/read', ['items' => [['id' => $comment['id'], 'activity_id' => $snapshot]]])->assertOk();
        $this->getJson($path.'/comments?url='.urlencode('http://review.test/about'))->assertJsonPath('comments.0.unread', true);
        $this->getJson($path.'/activity?unread_only=true')->assertJsonCount(1, 'events');
        $this->assertDatabaseHas('read_states', ['participant_id' => $reader['id'], 'comment_id' => $comment['id'], 'activity_id' => $snapshot]);
    }

    public function test_edit_and_delete_use_identity_not_display_name(): void
    {
        $site = $this->site();
        $one = $this->guest($site, 'Chris');
        $comment = $this->comment($site, $one);
        $two = $this->guest($site, 'Chris');
        $path = '/api/v1/sites/'.$site.'/comments/'.$comment['id'];
        $this->withToken($two['token'])->patchJson($path, ['body' => 'Stolen edit', 'version' => 1])->assertForbidden();
        $this->deleteJson($path)->assertForbidden();
        $this->withToken($one['token'])->patchJson($path, ['body' => 'My revised comment', 'version' => 1])->assertOk()->assertJsonPath('comment.version', 2)->assertJsonPath('comment.body', 'My revised comment');
        $this->patchJson($path, ['body' => 'Stale edit', 'version' => 1])->assertConflict();
        $this->deleteJson($path)->assertOk();
        $this->assertDatabaseCount('comments', 0);
        $this->assertDatabaseCount('activity', 0);
    }

    public function test_repositioning_is_site_scoped_and_checks_versions(): void
    {
        $site = $this->site();
        $one = $this->guest($site);
        $comment = $this->comment($site, $one);
        $two = $this->guest($site, 'Reviewer');
        $anchor = $comment['anchor'];
        $anchor['selector'] = '#replacement';
        $path = '/api/v1/sites/'.$site.'/comments/'.$comment['id'].'/anchor';
        $this->withToken($two['token'])->patchJson($path, ['anchor' => $anchor, 'version' => 1])->assertOk()->assertJsonPath('comment.anchor.selector', '#replacement')->assertJsonPath('comment.body', 'Improve this text');
        $this->patchJson($path, ['anchor' => $anchor, 'version' => 1])->assertConflict();
        $other = $this->site();
        $otherGuest = $this->guest($other);
        $this->withToken($otherGuest['token'])->patchJson('/api/v1/sites/'.$other.'/comments/'.$comment['id'].'/anchor', ['anchor' => $anchor, 'version' => 2])->assertNotFound();
    }

    public function test_reply_history_is_loaded_in_bounded_chronological_pages(): void
    {
        $site = $this->site();
        $guest = $this->guest($site);
        $comment = $this->comment($site, $guest);
        $path = '/api/v1/sites/'.$site.'/comments/'.$comment['id'];
        for ($i = 1; $i <= 25; $i++) {
            DB::table('replies')->insert(['comment_id' => $comment['id'], 'participant_id' => $guest['id'], 'client_id' => (string) Str::uuid(), 'body' => 'Reply '.$i, 'kind' => 'reply', 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->getJson($path)->assertOk()->assertJsonCount(25, 'replies');
        $detail = $this->getJson($path.'?reply_limit=2')->assertOk()->assertJsonCount(2, 'replies')->assertJsonPath('reply_count', 25)->json();
        $older = $this->getJson($path.'/replies?before='.$detail['reply_before'])->assertOk()->assertJsonCount(20, 'replies')->assertJsonPath('more', true)->json();
        $first = $this->getJson($path.'/replies?before='.$older['before'])->assertOk()->assertJsonCount(3, 'replies')->assertJsonPath('more', false)->json();
        $this->assertSame(array_map(fn ($i) => 'Reply '.$i, range(1, 25)), array_column(array_merge($first['replies'], $older['replies'], $detail['replies']), 'body'));
    }

    public function test_reply_and_attachment_deletion_enforce_ownership(): void
    {
        Storage::fake('local');
        $site = $this->site();
        $one = $this->guest($site);
        $comment = $this->comment($site, $one);
        $two = $this->guest($site, 'Other');
        $path = '/api/v1/sites/'.$site.'/comments/'.$comment['id'];
        $reply = $this->withToken($two['token'])->postJson($path.'/replies', ['body' => 'Other reply', 'client_id' => (string) Str::uuid()])->json('replies.0.id');
        $file = $this->postJson($path.'/attachments', ['client_id' => (string) Str::uuid(), 'file' => UploadedFile::fake()->image('screen.png')])->json('attachments.0.id');
        $this->withToken($one['token'])->deleteJson($path.'/replies/'.$reply)->assertForbidden();
        $this->deleteJson($path.'/attachments/'.$file)->assertForbidden();
        $this->withToken($two['token'])->deleteJson($path.'/replies/'.$reply)->assertOk()->assertJsonPath('reply_count', 0);
        $this->deleteJson($path.'/attachments/'.$file)->assertOk()->assertJsonCount(0, 'attachments');
        $this->assertDatabaseCount('replies', 0);
        $this->assertDatabaseCount('attachments', 0);
    }

    public function test_general_browsing_does_not_consume_guest_creation_quota(): void
    {
        $site = $this->site();
        $this->withToken('')->withHeader('Origin', 'http://review.test');
        for ($i = 0; $i < 25; $i++) {
            $this->getJson('/api/v1/sites/'.$site.'/config')->assertOk();
        }
        $this->postJson('/api/v1/sites/'.$site.'/guests', ['name' => 'New reader'])->assertCreated();
    }

    public function test_fifty_comments_do_not_require_per_comment_author_queries(): void
    {
        $site = $this->site();
        $guest = $this->guest($site);
        $c = $this->comment($site, $guest);
        $db = DB::class;
        for ($i = 0; $i < 49; $i++) {
            $db::table('comments')->insert(['site_id' => $site, 'page_id' => $c['page_id'], 'participant_id' => $guest['id'], 'client_id' => (string) Str::uuid(), 'body' => 'Bulk comment '.$i, 'status' => 'open', 'anchor' => json_encode($c['anchor']), 'created_at' => now(), 'updated_at' => now()]);
        }
        $db::enableQueryLog();
        $db::flushQueryLog();
        $this->getJson('/api/v1/sites/'.$site.'/comments?url='.urlencode('http://review.test/about'))->assertOk()->assertJsonCount(50, 'comments');
        $this->assertLessThanOrEqual(10, count($db::getQueryLog()));
        $db::disableQueryLog();
        $this->getJson('/api/v1/sites/'.$site.'/pages')->assertOk()->assertJsonPath('0.counts.open', 50);
    }

    public function test_invalid_targets_are_rejected(): void
    {
        $s = $this->site();
        $g = $this->guest($s);
        $this->withToken($g['token'])->postJson('/api/v1/sites/'.$s.'/comments', ['url' => 'http://review.test', 'title' => 'A', 'body' => 'x', 'status' => 'open', 'client_id' => (string) Str::uuid(), 'anchor' => ['selector' => '#x', 'x' => 2, 'y' => 0, 'documentX' => 0, 'documentY' => 0, 'viewportWidth' => 1200]])->assertUnprocessable();
    }
}
