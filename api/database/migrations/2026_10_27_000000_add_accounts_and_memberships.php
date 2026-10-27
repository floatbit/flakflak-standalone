<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', function (Blueprint $t) {
            $t->unsignedInteger('feedback_version')->default(1);
        });
        Schema::table('participants', function (Blueprint $t) {
            $t->unique(['site_id', 'user_id']);
        });
        Schema::create('memberships', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('role', 20);
            $t->timestamp('accepted_at');
            $t->unique(['site_id', 'user_id']);
        });
        Schema::create('login_links', function (Blueprint $t) {
            $t->id();
            $t->string('email');
            $t->char('token_hash', 64)->unique();
            $t->timestamp('expires_at');
            $t->timestamp('used_at')->nullable();
            $t->timestamp('created_at');
        });
        Schema::create('account_tokens', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('site_id')->nullable()->constrained()->cascadeOnDelete();
            $t->text('origin')->nullable();
            $t->char('token_hash', 64)->unique();
            $t->timestamp('expires_at');
            $t->timestamp('created_at');
        });
        Schema::create('invitations', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->string('email');
            $t->char('token_hash', 64)->unique();
            $t->text('encrypted_token');
            $t->timestamp('expires_at');
            $t->timestamp('accepted_at')->nullable();
            $t->timestamp('created_at');
            $t->timestamp('updated_at');
            $t->unique(['site_id', 'email']);
        });
        Schema::create('auth_handoffs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('site_id')->constrained()->cascadeOnDelete();
            $t->text('origin');
            $t->char('challenge', 64);
            $t->char('code_hash', 64)->unique();
            $t->timestamp('expires_at');
        });
    }

    public function down(): void
    {
        foreach (['auth_handoffs', 'invitations', 'account_tokens', 'login_links', 'memberships'] as $name) {
            Schema::dropIfExists($name);
        } Schema::table('participants', fn (Blueprint $t) => $t->dropUnique(['site_id', 'user_id']));
        Schema::table('sites', fn (Blueprint $t) => $t->dropColumn('feedback_version'));
    }
};
