<?php

use App\Http\Controllers\FeedbackController as F;
use App\Http\Controllers\InteractionController as I;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', [F::class, 'health']);
    Route::middleware(['throttle:owner-api', 'owner'])->group(function () {
        Route::get('/sites', [F::class, 'sites']);
        Route::post('/sites', [F::class, 'createSite']);
        Route::patch('/sites/{site}', [F::class, 'updateSite']);
    });
    Route::prefix('/sites/{site}')->middleware(['throttle:site-api', 'site.origin'])->group(function () {
        Route::get('/config', [F::class, 'site']);
        Route::post('/guests', [F::class, 'guest'])->middleware('throttle:guest-sessions');
        Route::get('/comments', [F::class, 'comments']);
        Route::get('/pages', [F::class, 'pages']);
        Route::get('/activity', [F::class, 'activity']);
        Route::get('/search', [F::class, 'search']);
        Route::get('/comments/{comment}', [F::class, 'detail'])->whereNumber('comment');
        Route::get('/comments/{comment}/replies', [I::class, 'replies'])->whereNumber('comment');
        Route::middleware('guest')->group(function () {
            Route::post('/comments', [F::class, 'createComment']);
            Route::post('/read', [I::class, 'markRead']);
            Route::patch('/comments/{comment}', [I::class, 'update'])->whereNumber('comment');
            Route::patch('/comments/{comment}/anchor', [I::class, 'move'])->whereNumber('comment');
            Route::delete('/comments/{comment}', [I::class, 'delete'])->whereNumber('comment');
            Route::delete('/comments/{comment}/replies/{reply}', [I::class, 'deleteReply'])->whereNumber(['comment', 'reply']);
            Route::delete('/comments/{comment}/attachments/{attachment}', [I::class, 'deleteAttachment'])->whereNumber(['comment', 'attachment']);
            Route::post('/comments/{comment}/replies', [F::class, 'reply'])->whereNumber('comment');
            Route::patch('/comments/{comment}/status', [F::class, 'status'])->whereNumber('comment');
            Route::post('/comments/{comment}/attachments', [F::class, 'upload'])->whereNumber('comment')->middleware('throttle:attachment-uploads');
        });
    });
});
Route::get('/attachments/{attachment}', [F::class, 'attachment'])->whereNumber('attachment')->middleware(['signed', 'throttle:media'])->name('attachment');
