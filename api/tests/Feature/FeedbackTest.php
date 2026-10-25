<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
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

    public function test_invalid_targets_are_rejected(): void
    {
        $s = $this->site();
        $g = $this->guest($s);
        $this->withToken($g['token'])->postJson('/api/v1/sites/'.$s.'/comments', ['url' => 'http://review.test', 'title' => 'A', 'body' => 'x', 'status' => 'open', 'client_id' => (string) Str::uuid(), 'anchor' => ['selector' => '#x', 'x' => 2, 'y' => 0, 'documentX' => 0, 'documentY' => 0, 'viewportWidth' => 1200]])->assertUnprocessable();
    }
}
