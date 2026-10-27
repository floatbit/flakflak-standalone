<?php

namespace App\Http\Middleware;

use App\Support\Accounts;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AccountSession
{
    public function handle(Request $r, Closure $next)
    {
        Accounts::dashboardOrigin($r);
        $token = Accounts::token($r);
        abort_unless($token && ! $token->site_id, 401, 'Sign in with your email to continue.');
        $account = DB::table('users')->find($token->user_id);
        abort_unless($account && $account->email_verified_at, 401, 'Verify your email to continue.');
        $r->attributes->set('account', $account);
        $r->attributes->set('account_token', $token);

        return $next($r);
    }
}
