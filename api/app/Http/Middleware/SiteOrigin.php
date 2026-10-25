<?php

namespace App\Http\Middleware;

use App\Support\PageUrl;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SiteOrigin
{
    public function handle(Request $request, Closure $next)
    {
        $site = DB::table('sites')->where('id', $request->route('site'))->first();
        abort_unless($site, 404);
        $origin = $request->header('Origin');
        abort_unless(is_string($origin) && in_array(PageUrl::origin($origin), json_decode($site->origins, true), true), 403, 'This origin is not enabled for the site.');
        $request->attributes->set('site', $site);

        return $next($request);
    }
}
