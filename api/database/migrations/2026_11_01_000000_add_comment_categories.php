<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->string('category', 20)->default('general')->index();
        });
        DB::table('comments')->where('status', 'content')->update(['category' => 'content', 'status' => 'open', 'version' => DB::raw('version + 1')]);
    }

    public function down(): void
    {
        // Category does not imply workflow state: never turn all Content items back into a status.
        Schema::table('comments', function (Blueprint $table) {
            $table->dropIndex(['category']);
            $table->dropColumn('category');
        });
    }
};
