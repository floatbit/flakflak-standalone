<?php

namespace Tests\Feature;

use App\Support\Accounts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class AccountTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['flakflak.dashboard_origin' => 'http://dashboard.test', 'app.url' => 'http://localhost']);
        config(['mail.default' => 'array']);
        Mail::purge();
    }

    private function account(string $email = 'owner@example.test'): array
    {
        $id = DB::table('users')->insertGetId(['name' => 'Owner', 'email' => $email, 'password' => 'unused', 'email_verified_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

        return ['id' => $id] + Accounts::issue($id);
    }

    private function dashboard(array $account): static
    {
        $this->withToken($account['token'])->withHeader('Origin', 'http://dashboard.test');

        return $this;
    }

    private function site(array $account): string
    {
        return $this->dashboard($account)->postJson('/api/v1/sites', ['name' => 'Private site', 'origins' => ['http://review.test']])->assertCreated()->json('id');
    }

    private function invitation(array $account, string $site, string $email): array
    {
        return $this->dashboard($account)->postJson('/api/v1/sites/'.$site.'/invitations', ['email' => $email])->assertOk()->json();
    }

    private function raw(array $invite): string
    {
        parse_str(parse_url($invite['url'], PHP_URL_FRAGMENT), $params);

        return $params['invitation'];
    }

    public function test_magic_links_are_verified_once_and_do_not_create_accounts_on_request(): void
    {
        $this->withHeader('Origin', 'http://dashboard.test')->postJson('/api/v1/auth/email', ['email' => 'new@example.test'])->assertOk()->assertJsonMissingPath('token');
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('login_links', 1);
        $body = Mail::mailer()->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        preg_match('/#magic=([A-Za-z0-9]{64})/', $body, $match);
        $raw = $match[1];
        $this->assertDatabaseMissing('login_links', ['token_hash' => $raw]);
        $result = $this->postJson('/api/v1/auth/verify', ['token' => $raw])->assertOk()->assertJsonPath('user.email', 'new@example.test')->json();
        $this->assertDatabaseHas('users', ['email' => 'new@example.test']);
        $this->assertDatabaseMissing('account_tokens', ['token_hash' => $result['token']]);
        $this->postJson('/api/v1/auth/verify', ['token' => $raw])->assertUnprocessable();
        $expired = Str::random(64);
        DB::table('login_links')->insert(['email' => 'old@example.test', 'token_hash' => hash('sha256', $expired), 'expires_at' => now()->subMinute(), 'created_at' => now()]);
        $this->postJson('/api/v1/auth/verify', ['token' => $expired])->assertUnprocessable();
    }

    public function test_invitation_requires_verified_matching_email_and_explicit_acceptance(): void
    {
        $owner = $this->account();
        $site = $this->site($owner);
        $invite = $this->invitation($owner, $site, 'member@example.test');
        $raw = $this->raw($invite);
        $this->postJson('/api/v1/invitations/preview', ['token' => $raw])->assertOk()->assertJsonPath('accepted', false);
        $this->assertDatabaseCount('memberships', 1);
        $wrong = $this->account('wrong@example.test');
        $this->dashboard($wrong)->postJson('/api/v1/invitations/accept', ['token' => $raw])->assertForbidden();
        $member = $this->account('member@example.test');
        $this->dashboard($member)->postJson('/api/v1/invitations/accept', ['token' => $raw])->assertOk()->assertJsonPath('status', 'Accepted');
        $this->postJson('/api/v1/invitations/accept', ['token' => $raw])->assertOk();
        $this->assertDatabaseCount('memberships', 2);
        $this->dashboard($owner)->getJson('/api/v1/sites/'.$site.'/members')->assertOk()->assertJsonCount(2, 'members')->assertJsonCount(0, 'invitations');
        $this->dashboard($member)->getJson('/api/v1/sites/'.$site.'/members')->assertForbidden();
    }

    public function test_deleted_and_replaced_invitation_links_fail_and_member_removal_blocks_access(): void
    {
        $owner = $this->account();
        $site = $this->site($owner);
        $first = $this->invitation($owner, $site, 'member@example.test');
        $raw = $this->raw($first);
        $new = $this->invitation($owner, $site, 'member@example.test');
        $this->postJson('/api/v1/invitations/preview', ['token' => $raw])->assertUnprocessable();
        $this->deleteJson('/api/v1/sites/'.$site.'/invitations/'.$new['id'])->assertOk();
        $this->postJson('/api/v1/invitations/preview', ['token' => $this->raw($new)])->assertUnprocessable();
        $invite = $this->invitation($owner, $site, 'member@example.test');
        $member = $this->account('member@example.test');
        $this->dashboard($member)->postJson('/api/v1/invitations/accept', ['token' => $this->raw($invite)])->assertOk();
        $token = Accounts::issue($member['id'], $site, 'http://review.test');
        $this->withToken($token['token'])->withHeader('Origin', 'http://review.test')->getJson('/api/v1/sites/'.$site.'/config')->assertOk();
        $this->dashboard($owner)->deleteJson('/api/v1/sites/'.$site.'/members/'.$member['id'])->assertOk();
        $this->withToken($token['token'])->withHeader('Origin', 'http://review.test')->getJson('/api/v1/sites/'.$site.'/config')->assertUnauthorized();
        $this->dashboard($member)->postJson('/api/v1/invitations/accept', ['token' => $this->raw($invite)])->assertUnprocessable();
    }

    public function test_handoff_is_bound_to_site_origin_and_verifier_and_is_single_use(): void
    {
        $owner = $this->account();
        $site = $this->site($owner);
        $verifier = Str::random(64);
        $code = $this->dashboard($owner)->postJson('/api/v1/auth/handoff', ['site' => $site, 'origin' => 'http://review.test', 'challenge' => hash('sha256', $verifier)])->assertOk()->json('code');
        $path = '/api/v1/sites/'.$site.'/auth/exchange';
        $this->withToken('')->withHeader('Origin', 'http://review.test')->postJson($path, ['code' => $code, 'verifier' => Str::random(64)])->assertUnauthorized();
        $this->postJson($path, ['code' => $code, 'verifier' => $verifier])->assertOk();
        $this->postJson($path, ['code' => $code, 'verifier' => $verifier])->assertUnauthorized();
        $outsider = $this->account('outsider@example.test');
        $this->dashboard($outsider)->postJson('/api/v1/auth/handoff', ['site' => $site, 'origin' => 'http://review.test', 'challenge' => hash('sha256', $verifier)])->assertForbidden();
    }

    public function test_uninvited_users_and_legacy_tokens_cannot_read_any_feedback(): void
    {
        $owner = $this->account();
        $site = $this->site($owner);
        $outsider = $this->account('outsider@example.test');
        foreach (['/config', '/comments?url=http://review.test/', '/pages', '/activity', '/search?query=a', '/comments/1', '/comments/1/replies?before=3', '/attachments/1'] as $path) {
            $this->withToken('')->withHeader('Origin', 'http://review.test')->getJson('/api/v1/sites/'.$site.$path)->assertUnauthorized();
            $this->dashboard($outsider)->getJson('/api/v1/sites/'.$site.$path)->assertForbidden();
        }
        $this->dashboard($outsider)->getJson('/api/v1/sites')->assertExactJson([]);
    }

    public function test_reset_removes_files_and_feedback_but_preserves_site_members_and_bumps_version(): void
    {
        Storage::fake('local');
        $owner = $this->account();
        $site = $this->site($owner);
        $p = Accounts::participant($owner['id'], $site);
        $scope = Accounts::issue($owner['id'], $site, 'http://review.test');
        $page = DB::table('pages')->insertGetId(['site_id' => $site, 'url' => 'http://review.test/', 'url_hash' => hash('sha256', 'http://review.test/'), 'title' => 'Home', 'created_at' => now(), 'updated_at' => now()]);
        $c = DB::table('comments')->insertGetId(['site_id' => $site, 'page_id' => $page, 'participant_id' => $p->id, 'client_id' => (string) Str::uuid(), 'body' => 'Private', 'status' => 'open', 'anchor' => '{}', 'created_at' => now(), 'updated_at' => now()]);
        $this->withToken($scope['token'])->withHeader('Origin', 'http://review.test')->postJson('/api/v1/sites/'.$site.'/comments/'.$c.'/attachments', ['file' => UploadedFile::fake()->image('test.png'), 'client_id' => (string) Str::uuid()])->assertOk();
        $url = $this->getJson('/api/v1/sites/'.$site.'/comments/'.$c)->json('attachments.0.url');
        $this->withToken('')->get($url)->assertUnauthorized();
        $this->dashboard($owner)->postJson('/api/v1/sites/'.$site.'/reset-feedback', ['confirmation' => 'wrong'])->assertUnprocessable();
        $this->postJson('/api/v1/sites/'.$site.'/reset-feedback', ['confirmation' => 'Private site'])->assertOk()->assertJsonPath('feedback_version', 2);
        $this->assertDatabaseCount('comments', 0);
        $this->assertDatabaseCount('attachments', 0);
        $this->assertDatabaseCount('pages', 0);
        $this->assertDatabaseCount('memberships', 1);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_sign_out_revokes_account_site_sessions_and_pending_handoffs(): void
    {
        $owner = $this->account();
        $site = $this->site($owner);
        $scope = Accounts::issue($owner['id'], $site, 'http://review.test');
        $verifier = Str::random(64);
        $code = $this->dashboard($owner)->postJson('/api/v1/auth/handoff', ['site' => $site, 'origin' => 'http://review.test', 'challenge' => hash('sha256', $verifier)])->assertOk()->json('code');
        $this->postJson('/api/v1/auth/logout')->assertOk();
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->withToken($scope['token'])->withHeader('Origin', 'http://review.test')->getJson('/api/v1/sites/'.$site.'/config')->assertUnauthorized();
        $this->postJson('/api/v1/sites/'.$site.'/auth/exchange', ['code' => $code, 'verifier' => $verifier])->assertUnauthorized();
    }

    public function test_claim_only_assigns_unowned_sites_to_verified_accounts(): void
    {
        $owner = $this->account();
        $site = (string) Str::uuid();
        DB::table('sites')->insert(['id' => $site, 'name' => 'Legacy site', 'origins' => json_encode(['http://review.test']), 'created_at' => now(), 'updated_at' => now()]);
        $this->artisan('flakflak:claim', ['email' => 'owner@example.test', '--site' => $site])->assertSuccessful();
        $this->assertDatabaseHas('memberships', ['site_id' => $site, 'user_id' => $owner['id'], 'role' => 'owner']);
        $other = $this->account('other@example.test');
        $this->artisan('flakflak:claim', ['email' => 'other@example.test', '--site' => $site])->assertSuccessful();
        $this->assertDatabaseMissing('memberships', ['site_id' => $site, 'user_id' => $other['id']]);
    }

    public function test_expired_account_and_old_guest_tokens_do_not_grant_access(): void
    {
        $owner = $this->account();
        $site = $this->site($owner);
        $raw = Str::random(64);
        DB::table('participants')->insert(['id' => (string) Str::uuid(), 'site_id' => $site, 'name' => 'Legacy', 'token_hash' => hash('sha256', $raw), 'expires_at' => now()->addDay(), 'created_at' => now(), 'updated_at' => now()]);
        $this->withToken($raw)->withHeader('Origin', 'http://review.test')->getJson('/api/v1/sites/'.$site.'/config')->assertUnauthorized();
        DB::table('account_tokens')->where('user_id', $owner['id'])->update(['expires_at' => now()->subMinute()]);
        $this->dashboard($owner)->getJson('/api/v1/sites')->assertUnauthorized();
    }

    public function test_nuke_requires_confirmation_and_clears_application_data_only(): void
    {
        Storage::fake('local');
        $owner = $this->account();
        $site = $this->site($owner);
        $this->invitation($owner, $site, 'invited@example.test');
        Storage::disk('local')->put('attachments/'.$site.'/file.png', 'image');
        Storage::disk('local')->put('keep.txt', 'configuration');
        $migrationCount = DB::table('migrations')->count();
        $this->artisan('flakflak:nuke')->expectsConfirmation('Are you sure you want to delete everything?', 'no')->assertSuccessful();
        $this->assertDatabaseHas('sites', ['id' => $site]);
        Storage::disk('local')->assertExists('attachments/'.$site.'/file.png');
        $this->artisan('flakflak:nuke')->expectsConfirmation('Are you sure you want to delete everything?', 'yes')->assertSuccessful();
        foreach (['users', 'sites', 'memberships', 'invitations', 'account_tokens'] as $table) {
            $this->assertDatabaseCount($table, 0);
        }
        Storage::disk('local')->assertMissing('attachments/'.$site.'/file.png');
        Storage::disk('local')->assertExists('keep.txt');
        $this->assertSame($migrationCount, DB::table('migrations')->count());
        $this->assertFalse(app()->isDownForMaintenance());
    }
}
