<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class FeedbackReset
{
    public static function run(string $site): int
    {
        return DB::transaction(function () use ($site) {
            $s = DB::table('sites')->where('id', $site)->lockForUpdate()->firstOrFail();
            // Remove files before database rows: failures leave records for a retry.
            $files = DB::table('attachments')->join('comments', 'comments.id', '=', 'attachments.comment_id')->where('comments.site_id', $site)->pluck('attachments.path');
            foreach ($files as $path) {
                if (Storage::disk('local')->exists($path) && ! Storage::disk('local')->delete($path)) {
                    throw new \RuntimeException('Could not delete an attachment. Retry the reset.');
                }
            }
            abort_if(Storage::disk('local')->exists('attachments/'.$site) && ! Storage::disk('local')->deleteDirectory('attachments/'.$site), 500, 'Could not remove the attachment directory.');
            DB::table('comments')->where('site_id', $site)->delete();
            DB::table('pages')->where('site_id', $site)->delete();
            DB::table('participants')->where('site_id', $site)->whereNull('user_id')->delete();
            DB::table('sites')->where('id', $site)->update(['feedback_version' => $s->feedback_version + 1, 'updated_at' => now()]);

            return $s->feedback_version + 1;
        });
    }
}
