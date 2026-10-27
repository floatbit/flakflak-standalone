<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class Accounts
{
    public static function token(Request $r): ?object
    {
        return DB::table('account_tokens')->where('token_hash', hash('sha256', $r->bearerToken() ?? ''))->where('expires_at', '>', now())->first();
    }

    public static function issue(int $user, ?string $site = null, ?string $origin = null): array
    {
        $raw = Str::random(64);
        $expires = $site ? now()->addDay() : now()->addDays(30);
        DB::table('account_tokens')->insert(['id' => (string) Str::uuid(), 'user_id' => $user, 'site_id' => $site, 'origin' => $origin, 'token_hash' => hash('sha256', $raw), 'expires_at' => $expires, 'created_at' => now()]);

        return ['token' => $raw, 'expires_at' => $expires->toISOString()];
    }

    public static function member(int $user, string $site): ?object
    {
        return DB::table('memberships')->where('site_id', $site)->where('user_id', $user)->first();
    }

    public static function participant(int $user, string $site): object
    {
        $existing = DB::table('participants')->where('site_id', $site)->where('user_id', $user)->first();
        if ($existing) {
            return $existing;
        }
        $name = DB::table('users')->where('id', $user)->value('name');
        DB::table('participants')->insertOrIgnore(['id' => (string) Str::uuid(), 'site_id' => $site, 'user_id' => $user, 'name' => $name, 'token_hash' => hash('sha256', Str::random(64)), 'expires_at' => now()->addYears(10), 'created_at' => now(), 'updated_at' => now()]);

        return DB::table('participants')->where('site_id', $site)->where('user_id', $user)->first();
    }

    public static function dashboardOrigin(Request $r): void
    {
        abort_if($r->header('Origin') && $r->header('Origin') !== config('flakflak.dashboard_origin'), 403, 'Open this action in the FlakFlak dashboard.');
    }
}
