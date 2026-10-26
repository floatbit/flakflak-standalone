<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        foreach (['site-api' => 180, 'guest-sessions' => 20, 'attachment-uploads' => 30, 'owner-api' => 60, 'media' => 180] as $name => $count) {
            RateLimiter::for($name, fn (Request $request) => Limit::perMinute($count)->by($request->ip().'|'.(string) $request->route('site')));
        }
    }
}
