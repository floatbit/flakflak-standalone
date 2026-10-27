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
        RateLimiter::for('magic-email', fn (Request $r) => [Limit::perMinute(5)->by('mail-ip|'.$r->ip()), Limit::perHour(6)->by('mail-address|'.hash('sha256', strtolower(trim((string) $r->input('email')))))]);
        foreach (['site-api' => 180, 'attachment-uploads' => 30, 'owner-api' => 60, 'media' => 180, 'magic-verify' => 30] as $name => $count) {
            RateLimiter::for($name, fn (Request $request) => Limit::perMinute($count)->by($request->ip().'|'.(string) $request->route('site')));
        }
    }
}
