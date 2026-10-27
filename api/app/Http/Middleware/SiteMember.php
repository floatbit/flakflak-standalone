<?php

namespace App\Http\Middleware;

use App\Support\Accounts;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SiteMember
{
    public function handle(Request $r, Closure $next)
    {
        $token = Accounts::token($r);
        abort_unless($token, 401, 'Sign in to access this site.');
        $site = $r->route('site');
        abort_if($token->site_id && ($token->site_id !== $site || $token->origin !== $r->header('Origin')), 403, 'This session belongs to a different site or origin.');
        if (! $token->site_id) {
            Accounts::dashboardOrigin($r);
        }
        $member = Accounts::member($token->user_id, $site);
        abort_unless($member, 403, 'An invitation is required to access this site.');
        $account = DB::table('users')->find($token->user_id);
        abort_unless($account && $account->email_verified_at, 401, 'Verify your email to continue.');
        $r->attributes->set('account', $account);
        $r->attributes->set('account_token', $token);
        $r->attributes->set('membership', $member);
        $r->attributes->set('participant', Accounts::participant($token->user_id, $site));
        if (! in_array($r->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return DB::transaction(function () use ($r, $site, $next) {
                $current = DB::table('sites')->where('id', $site)->lockForUpdate()->firstOrFail();
                if ($r->hasHeader('X-Feedback-Version')) {
                    abort_unless((int) $r->header('X-Feedback-Version') === (int) $current->feedback_version, 409, 'Feedback was reset. Reconnect before submitting.');
                }

                return $next($r);
            });
        }

        return $next($r);
    }
}
