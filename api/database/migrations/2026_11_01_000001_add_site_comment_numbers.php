<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sites', fn (Blueprint $table) => $table->unsignedBigInteger('next_comment_number')->default(1));
        Schema::table('comments', fn (Blueprint $table) => $table->unsignedBigInteger('comment_number')->nullable());
        DB::table('sites')->orderBy('id')->select('id')->chunk(100, function ($sites) {
            foreach ($sites as $site) {
                DB::transaction(function () use ($site) {
                    DB::table('sites')->where('id', $site->id)->lockForUpdate()->first();
                    $number = 1;
                    DB::table('comments')->where('site_id', $site->id)->orderBy('created_at')->orderBy('id')->select('id')->chunk(500, function ($comments) use (&$number) {
                        foreach ($comments as $comment) {
                            DB::table('comments')->where('id', $comment->id)->update(['comment_number' => $number++]);
                        }
                    });
                    DB::table('sites')->where('id', $site->id)->update(['next_comment_number' => $number]);
                });
            }
        });
        Schema::table('comments', fn (Blueprint $table) => $table->unique(['site_id', 'comment_number']));
    }

    public function down(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->dropUnique(['site_id', 'comment_number']);
            $table->dropColumn('comment_number');
        });
        Schema::table('sites', fn (Blueprint $table) => $table->dropColumn('next_comment_number'));
    }
};
