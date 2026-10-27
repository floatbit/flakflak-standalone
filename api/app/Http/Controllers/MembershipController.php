<?php

namespace App\Http\Controllers;

use App\Support\Accounts;
use App\Support\FeedbackReset;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class MembershipController extends Controller
{
    public static function owner(Request $r, string $site): void
    {
        abort_unless(Accounts::member($r->attributes->get('account')->id, $site)?->role === 'owner', 403, 'Only the site owner can manage this site.');
    }

    private function link(object $i): string
    {
        return rtrim(config('flakflak.dashboard_origin'), '/').'/#invitation='.rawurlencode(Crypt::decryptString($i->encrypted_token));
    }

    public function index(Request $r, string $site)
    {
        self::owner($r, $site);
        $members = DB::table('memberships')->join('users', 'users.id', '=', 'memberships.user_id')->where('site_id', $site)->get(['users.id', 'users.name', 'users.email', 'memberships.role', 'memberships.accepted_at']);
        $pending = DB::table('invitations')->where('site_id', $site)->whereNull('accepted_at')->get()->map(fn ($i) => ['id' => $i->id, 'email' => $i->email, 'status' => 'Pending', 'created_at' => $i->created_at, 'url' => $this->link($i)]);

        return ['members' => $members, 'invitations' => $pending, 'counts' => ['comments' => DB::table('comments')->where('site_id', $site)->count(), 'files' => DB::table('attachments')->join('comments', 'comments.id', '=', 'attachments.comment_id')->where('comments.site_id', $site)->count()]];
    }

    public function invite(Request $r, string $site)
    {
        self::owner($r, $site);
        $v = $r->validate(['email' => 'required|email|max:254']);
        $email = strtolower(trim($v['email']));
        abort_if(DB::table('memberships')->join('users', 'users.id', '=', 'memberships.user_id')->where('site_id', $site)->where('users.email', $email)->exists(), 422, 'This person already has site access.');
        $raw = Str::random(64);
        DB::table('invitations')->updateOrInsert(['site_id' => $site, 'email' => $email], ['id' => (string) Str::uuid(), 'token_hash' => hash('sha256', $raw), 'encrypted_token' => Crypt::encryptString($raw), 'expires_at' => now()->addDays(7), 'accepted_at' => null, 'created_at' => now(), 'updated_at' => now()]);
        $i = DB::table('invitations')->where('site_id', $site)->where('email', $email)->first();
        $url = $this->link($i);
        $name = DB::table('sites')->where('id', $site)->value('name');
        Mail::raw('You have been invited to review '.$name." on FlakFlak.\n\n".$url."\n\nSign in with ".$email.' and accept the invitation. This link expires in 7 days.', fn ($m) => $m->to($email)->subject('Invitation to '.$name.' on FlakFlak'));

        return ['id' => $i->id, 'email' => $email, 'status' => 'Pending', 'url' => $url];
    }

    public function deleteInvite(Request $r, string $site, string $invitation)
    {
        self::owner($r, $site);
        $i = DB::table('invitations')->where('site_id', $site)->where('id', $invitation)->firstOrFail();
        abort_if($i->accepted_at, 409, 'Remove the member instead.');
        DB::table('invitations')->where('id', $i->id)->delete();

        return ['deleted' => true];
    }

    public function preview(Request $r)
    {
        Accounts::dashboardOrigin($r);
        $v = $r->validate(['token' => 'required|string|size:64']);
        $i = $this->find($v['token']);

        return ['site_name' => DB::table('sites')->where('id', $i->site_id)->value('name'), 'email' => $i->email, 'accepted' => (bool) $i->accepted_at];
    }

    private function find(string $raw): object
    {
        $i = DB::table('invitations')->where('token_hash', hash('sha256', $raw))->first();
        abort_unless($i && ($i->accepted_at || $i->expires_at > now()), 422, 'This invitation is invalid or expired. Ask the site owner for a new link.');

        return $i;
    }

    public function accept(Request $r)
    {
        $v = $r->validate(['token' => 'required|string|size:64']);
        $u = $r->attributes->get('account');
        abort_unless(trim($u->name) !== '', 422, 'Enter your display name first.');

        return DB::transaction(function () use ($v, $u) {
            $i = DB::table('invitations')->where('token_hash', hash('sha256', $v['token']))->lockForUpdate()->first();
            abort_unless($i && (! $i->expires_at || $i->expires_at > now() || $i->accepted_at), 422, 'This invitation is invalid or expired.');
            abort_unless($u->email_verified_at && strtolower($u->email) === $i->email, 403, 'Sign in with the email address this invitation was sent to.');
            // A removed member cannot regain access with an old accepted invitation.
            if ($i->accepted_at) {
                abort_unless(Accounts::member($u->id, $i->site_id), 403);

                return ['site_id' => $i->site_id, 'status' => 'Accepted'];
            }
            DB::table('memberships')->insertOrIgnore(['site_id' => $i->site_id, 'user_id' => $u->id, 'role' => 'member', 'accepted_at' => now()]);
            DB::table('invitations')->where('id', $i->id)->update(['accepted_at' => now(), 'updated_at' => now()]);

            return ['site_id' => $i->site_id, 'status' => 'Accepted'];
        });
    }

    public function remove(Request $r, string $site, string $user)
    {
        self::owner($r, $site);
        $member = Accounts::member((int) $user, $site);
        abort_unless($member, 404);
        abort_if($member->role === 'owner', 422, 'The site owner cannot be removed.');
        DB::transaction(function () use ($site, $user) {
            DB::table('memberships')->where('site_id', $site)->where('user_id', $user)->delete();
            DB::table('account_tokens')->where('site_id', $site)->where('user_id', $user)->delete();
            DB::table('auth_handoffs')->where('site_id', $site)->where('user_id', $user)->delete();
            $email = DB::table('users')->where('id', $user)->value('email');
            DB::table('invitations')->where('site_id', $site)->where('email', $email)->delete();
        });

        return ['removed' => true];
    }

    public function reset(Request $r, string $site)
    {
        self::owner($r, $site);
        $v = $r->validate(['confirmation' => 'required|string']);
        abort_unless(hash_equals(DB::table('sites')->where('id', $site)->value('name'), $v['confirmation']), 422, 'Type the site name exactly to confirm.');

        return ['feedback_version' => FeedbackReset::run($site)];
    }
}
