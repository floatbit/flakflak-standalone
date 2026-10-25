<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sites', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name', 100);
            $t->json('origins');
            $t->timestamps();
        });
        Schema::create('pages', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->text('url');
            $t->char('url_hash', 64);
            $t->string('title');
            $t->timestamps();
            $t->unique(['site_id', 'url_hash']);
        });
        Schema::create('participants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name', 100);
            $t->char('token_hash', 64)->unique();
            $t->timestamp('expires_at');
            $t->timestamps();
        });
        Schema::create('comments', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->foreignId('page_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('participant_id')->constrained()->restrictOnDelete();
            $t->uuid('client_id');
            $t->text('body');
            $t->string('status', 20)->default('open');
            $t->json('anchor');
            $t->unsignedInteger('version')->default(1);
            $t->timestamps();
            $t->unique(['site_id', 'client_id']);
            $t->index(['site_id', 'page_id', 'id']);
        });
        Schema::create('replies', function (Blueprint $t) {
            $t->id();
            $t->foreignId('comment_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('participant_id')->constrained()->restrictOnDelete();
            $t->uuid('client_id');
            $t->text('body');
            $t->string('kind', 20)->default('reply');
            $t->timestamps();
            $t->unique(['comment_id', 'client_id']);
        });
        Schema::create('attachments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('comment_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('participant_id')->constrained()->restrictOnDelete();
            $t->uuid('client_id');
            $t->string('path');
            $t->string('name');
            $t->string('mime', 100);
            $t->unsignedBigInteger('size');
            $t->timestamps();
            $t->unique(['comment_id', 'client_id']);
        });
        Schema::create('activity', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->foreignId('comment_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('participant_id')->constrained()->restrictOnDelete();
            $t->string('type', 20);
            $t->text('summary');
            $t->timestamp('created_at');
            $t->index(['site_id', 'id']);
        });
        Schema::create('read_states', function (Blueprint $t) {
            $t->foreignUuid('participant_id')->constrained()->cascadeOnDelete();
            $t->foreignId('comment_id')->constrained()->cascadeOnDelete();
            $t->unsignedBigInteger('activity_id')->default(0);
            $t->primary(['participant_id', 'comment_id']);
        });
    }

    public function down(): void
    {
        foreach (['read_states', 'activity', 'attachments', 'replies', 'comments', 'participants', 'pages', 'sites'] as $name) {
            Schema::dropIfExists($name);
        }
    }
};
