<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class OwnerKey
{
    public function handle(Request $request, Closure $next)
    {
        $key = config('flakflak.owner_key');
        abort_unless(is_string($key) && strlen($key) >= 32 && hash_equals($key, $request->bearerToken() ?? ''), 401, 'Enter your private owner key.');
        abort_unless(! $request->header('Origin') || $request->header('Origin') === config('flakflak.dashboard_origin'), 403, 'Dashboard origin is not allowed.');

        return $next($request);
    }
}
