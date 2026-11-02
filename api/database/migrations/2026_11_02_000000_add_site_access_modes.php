<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', fn (Blueprint $table) => $table->string('mode', 10)->default('private'));
        Schema::table('participants', fn (Blueprint $table) => $table->string('guest_origin', 500)->nullable());
    }

    public function down(): void
    {
        Schema::table('participants', fn (Blueprint $table) => $table->dropColumn('guest_origin'));
        Schema::table('sites', fn (Blueprint $table) => $table->dropColumn('mode'));
    }
};
