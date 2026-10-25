<?php

use App\Http\Controllers\FeedbackController as F;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', [F::class, 'health']);
    Route::middleware(['throttle:60,1', 'owner'])->group(function () {
        Route::get('/sites', [F::class, 'sites']);
        Route::post('/sites', [F::class, 'createSite']);
        Route::patch('/sites/{site}', [F::class, 'updateSite']);
    });
    Route::prefix('/sites/{site}')->middleware(['throttle:180,1', 'site.origin'])->group(function () {
        Route::get('/config', [F::class, 'site']);
        Route::post('/guests', [F::class, 'guest'])->middleware('throttle:20,1');
        Route::get('/comments', [F::class, 'comments']);
        Route::get('/pages', [F::class, 'pages']);
        Route::get('/activity', [F::class, 'activity']);
        Route::get('/search', [F::class, 'search']);
        Route::get('/comments/{comment}', [F::class, 'detail'])->whereNumber('comment');
        Route::middleware('guest')->group(function () {
            Route::post('/comments', [F::class, 'createComment']);
            Route::post('/comments/{comment}/replies', [F::class, 'reply'])->whereNumber('comment');
            Route::patch('/comments/{comment}/status', [F::class, 'status'])->whereNumber('comment');
            Route::post('/comments/{comment}/attachments', [F::class, 'upload'])->whereNumber('comment')->middleware('throttle:30,1');
        });
    });
});
Route::get('/attachments/{attachment}', [F::class, 'attachment'])->whereNumber('attachment')->middleware(['signed', 'throttle:180,1'])->name('attachment');
