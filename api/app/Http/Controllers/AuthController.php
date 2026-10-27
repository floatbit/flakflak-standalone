<?php

namespace App\Http\Controllers;

use App\Support\Accounts;
use App\Support\PageUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function send(Request $r)
    {
        Accounts::dashboardOrigin($r);
        abort_if(app()->environment('production') && in_array(config('mail.default'), ['log', 'array'], true), 503, 'Email delivery is not configured. Contact the site owner.');
        $v = $r->validate(['email' => 'required|email|max:254', 'invitation' => 'nullable|string|max:100']);
        $email = strtolower(trim($v['email']));
        $raw = Str::random(64);
        DB::table('login_links')->insert(['email' => $email, 'token_hash' => hash('sha256', $raw), 'expires_at' => now()->addMinutes(15), 'created_at' => now()]);
        $url = rtrim(config('flakflak.dashboard_origin'), '/').'/?magic='.rawurlencode($raw);
        // Tokens stay in the URL fragment so hosts and referrers do not log them.
        $url = str_replace('/?magic=', '/#magic=', $url);
        if (! empty($v['invitation'])) {
            $url .= '&invitation='.rawurlencode($v['invitation']);
        }
        Mail::raw("Sign in to FlakFlak:\n\n".$url."\n\nThis link expires in 15 minutes and works once. Open it, then confirm sign-in. If you did not request it, ignore this email.", fn ($m) => $m->to($email)->subject('Your FlakFlak sign-in link'));

        return ['message' => 'Check your email for a sign-in link.'];
    }

    public function verify(Request $r)
    {
        Accounts::dashboardOrigin($r);
        $v = $r->validate(['token' => 'required|string|size:64']);
        $user = DB::transaction(function () use ($v) {
            $link = DB::table('login_links')->where('token_hash', hash('sha256', $v['token']))->lockForUpdate()->first();
            abort_unless($link && ! $link->used_at && $link->expires_at > now(), 422, 'This sign-in link is invalid or expired. Request a new link.');
            DB::table('login_links')->where('id', $link->id)->update(['used_at' => now()]);
            DB::table('users')->insertOrIgnore(['email' => $link->email, 'name' => '', 'password' => Hash::make(Str::random(64)), 'email_verified_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            $user = DB::table('users')->where('email', $link->email)->first();
            DB::table('users')->where('id', $user->id)->update(['email_verified_at' => now()]);

            return $user;
        });

        return array_merge(Accounts::issue($user->id), ['user' => $this->publicUser($user)]);
    }

    private function publicUser(object $u): array
    {
        return ['id' => $u->id, 'name' => $u->name, 'email' => $u->email];
    }

    public function me(Request $r)
    {
        return ['user' => $this->publicUser($r->attributes->get('account'))];
    }

    public function profile(Request $r)
    {
        $v = $r->validate(['name' => 'required|string|max:100']);
        $u = $r->attributes->get('account');
        DB::table('users')->where('id', $u->id)->update(['name' => trim($v['name']), 'updated_at' => now()]);
        DB::table('participants')->where('user_id', $u->id)->update(['name' => trim($v['name'])]);

        return ['user' => $this->publicUser(DB::table('users')->find($u->id))];
    }

    public function logout(Request $r)
    {
        DB::table('account_tokens')->where('user_id', $r->attributes->get('account')->id)->delete();
        DB::table('auth_handoffs')->where('user_id', $r->attributes->get('account')->id)->delete();

        return ['signed_out' => true];
    }

    public function siteLogout(Request $r)
    {
        DB::table('account_tokens')->where('id', $r->attributes->get('account_token')->id)->delete();

        return ['signed_out' => true];
    }

    public function handoff(Request $r)
    {
        $v = $r->validate(['site' => 'required|uuid', 'origin' => 'required|url|max:500', 'challenge' => 'required|regex:/^[a-f0-9]{64}$/']);
        $u = $r->attributes->get('account');
        abort_unless(trim($u->name) !== '', 422, 'Enter your display name first.');
        abort_unless(Accounts::member($u->id, $v['site']), 403, 'An invitation is required to access this site.');
        $site = DB::table('sites')->find($v['site']);
        $origin = PageUrl::origin($v['origin']);
        abort_unless($origin === $v['origin'] && in_array($origin, json_decode($site->origins, true), true), 403, 'This website is not enabled for the site.');
        $code = Str::random(64);
        DB::table('auth_handoffs')->insert(['user_id' => $u->id, 'site_id' => $site->id, 'origin' => $origin, 'challenge' => $v['challenge'], 'code_hash' => hash('sha256', $code), 'expires_at' => now()->addMinutes(2)]);

        return ['code' => $code];
    }

    public function exchange(Request $r, string $site)
    {
        $v = $r->validate(['code' => 'required|string|size:64', 'verifier' => 'required|string|min:43|max:128']);

        return DB::transaction(function () use ($r, $site, $v) {
            $row = DB::table('auth_handoffs')->where('code_hash', hash('sha256', $v['code']))->lockForUpdate()->first();
            abort_unless($row && $row->site_id === $site && $row->origin === $r->header('Origin') && $row->expires_at > now() && hash_equals($row->challenge, hash('sha256', $v['verifier'])), 401, 'The sign-in handoff is invalid or expired.');
            abort_unless(Accounts::member($row->user_id, $site), 403, 'Site access has been removed.');
            DB::table('auth_handoffs')->where('id', $row->id)->delete();
            $p = Accounts::participant($row->user_id, $site);
            $m = Accounts::member($row->user_id, $site);

            return array_merge(Accounts::issue($row->user_id, $site, $row->origin), ['id' => $p->id, 'name' => $p->name, 'user_id' => $p->user_id, 'role' => $m->role]);
        });
    }
}
