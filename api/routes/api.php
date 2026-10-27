<?php

use App\Http\Controllers\AuthController as A;
use App\Http\Controllers\FeedbackController as F;
use App\Http\Controllers\InteractionController as I;
use App\Http\Controllers\MembershipController as M;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', [F::class, 'health']);
    Route::post('/auth/email', [A::class, 'send'])->middleware('throttle:magic-email');
    Route::post('/auth/verify', [A::class, 'verify'])->middleware('throttle:magic-verify');
    Route::post('/invitations/preview', [M::class, 'preview'])->middleware('throttle:magic-verify');
    Route::middleware(['throttle:owner-api', 'account'])->group(function () {
        Route::get('/auth/me', [A::class, 'me']);
        Route::patch('/auth/profile', [A::class, 'profile']);
        Route::post('/auth/logout', [A::class, 'logout']);
        Route::post('/auth/handoff', [A::class, 'handoff']);
        Route::post('/invitations/accept', [M::class, 'accept']);
        Route::get('/sites/{site}/members', [M::class, 'index']);
        Route::post('/sites/{site}/invitations', [M::class, 'invite']);
        Route::delete('/sites/{site}/invitations/{invitation}', [M::class, 'deleteInvite']);
        Route::delete('/sites/{site}/members/{user}', [M::class, 'remove']);
        Route::post('/sites/{site}/reset-feedback', [M::class, 'reset']);
        Route::get('/sites', [F::class, 'sites']);
        Route::post('/sites', [F::class, 'createSite']);
        Route::patch('/sites/{site}', [F::class, 'updateSite']);
    });
    Route::post('/sites/{site}/auth/exchange', [A::class, 'exchange'])->middleware(['throttle:magic-verify', 'site.origin']);
    Route::prefix('/sites/{site}')->middleware(['throttle:site-api', 'site.origin', 'member'])->group(function () {
        Route::post('/auth/logout', [A::class, 'siteLogout']);
        Route::get('/config', [F::class, 'site']);
        Route::get('/comments', [F::class, 'comments']);
        Route::get('/pages', [F::class, 'pages']);
        Route::get('/activity', [F::class, 'activity']);
        Route::get('/search', [F::class, 'search']);
        Route::get('/comments/{comment}', [F::class, 'detail'])->whereNumber('comment');
        Route::get('/comments/{comment}/replies', [I::class, 'replies'])->whereNumber('comment');
        Route::get('/attachments/{attachment}', [F::class, 'attachment'])->whereNumber('attachment');
        Route::post('/comments', [F::class, 'createComment']);
        Route::post('/read', [I::class, 'markRead']);
        Route::patch('/comments/{comment}', [I::class, 'update'])->whereNumber('comment');
        Route::patch('/comments/{comment}/anchor', [I::class, 'move'])->whereNumber('comment');
        Route::delete('/comments/{comment}', [I::class, 'delete'])->whereNumber('comment');
        Route::delete('/comments/{comment}/replies/{reply}', [I::class, 'deleteReply'])->whereNumber(['comment', 'reply']);
        Route::delete('/comments/{comment}/attachments/{attachment}', [I::class, 'deleteAttachment'])->whereNumber(['comment', 'attachment']);
        Route::post('/comments/{comment}/replies', [F::class, 'reply']);
        Route::patch('/comments/{comment}/status', [F::class, 'status']);
        Route::post('/comments/{comment}/attachments', [F::class, 'upload'])->middleware('throttle:attachment-uploads');
    });
});
Route::get('/attachments/{attachment}', fn () => abort(401, 'Sign in to view attachments.'));
