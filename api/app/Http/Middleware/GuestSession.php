<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GuestSession
{
    public function handle(Request $request, Closure $next)
    {
        $guest = DB::table('participants')->where('site_id', $request->route('site'))
            ->where('token_hash', hash('sha256', $request->bearerToken() ?? ''))->where('expires_at', '>', now())->first();
        abort_unless($guest, 401, 'Your guest session has expired. Enter your name to continue.');
        $request->attributes->set('participant', $guest);

        return $next($request);
    }
}
