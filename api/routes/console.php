<?php

use App\Support\FeedbackReset;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('flakflak:claim {email} {--site=} {--reset-feedback}', function () {
    $email = strtolower(trim($this->argument('email')));
    $user = DB::table('users')->where('email', $email)->whereNotNull('email_verified_at')->first();
    if (! $user) {
        $this->error('Sign in with this email first.');

        return 1;
    }
    $sites = DB::table('sites')->when($this->option('site'), fn ($q) => $q->where('id', $this->option('site')))->get();
    foreach ($sites as $site) {
        if (DB::table('memberships')->where('site_id', $site->id)->where('role', 'owner')->exists()) {
            $this->warn('Skipping already-owned site: '.$site->name);

            continue;
        }
        DB::table('memberships')->updateOrInsert(['site_id' => $site->id, 'user_id' => $user->id], ['role' => 'owner', 'accepted_at' => now()]);
        if ($this->option('reset-feedback')) {
            FeedbackReset::run($site->id);
        }
        $this->info('Owner assigned: '.$site->name);
    }
})->purpose('Assign a verified account ownership of legacy unowned sites; optionally reset their feedback');

Artisan::command('flakflak:prune-auth', function () {
    foreach (['login_links', 'account_tokens', 'auth_handoffs'] as $table) {
        DB::table($table)->where('expires_at', '<', now()->subDay())->delete();
    }
    $this->info('Expired authentication records pruned.');
})->purpose('Prune expired magic links, sessions, and authorization handoffs');
Schedule::command('flakflak:prune-auth')->daily();

Artisan::command('flakflak:nuke', function () {
    $this->warn('Permanently removes ALL FlakFlak accounts, sites, invitations, feedback, and uploaded files.');
    $this->line('Environment: '.app()->environment());
    $this->line('Database: '.config('database.connections.'.config('database.default').'.database'));
    $this->line('API folder: '.base_path());
    $this->line('Code, configuration, migrations, backups, and log files are retained.');
    if (! $this->confirm('Are you sure you want to delete everything?', false)) {
        $this->info('Cancelled. Nothing was deleted.');

        return 0;
    }
    $alreadyDown = app()->isDownForMaintenance();
    if (! $alreadyDown) {
        $this->call('down');
    }
    try {
        $disk = Storage::disk('local');
        if ($disk->exists('attachments') && ! $disk->deleteDirectory('attachments')) {
            throw new RuntimeException('Could not remove attachments. Database was not reset.');
        }
        DB::transaction(function () {
            // Explicit application tables only: preserve migrations and unrelated tables.
            foreach (['auth_handoffs', 'account_tokens', 'login_links', 'invitations', 'memberships', 'read_states', 'activity', 'attachments', 'replies', 'comments', 'pages', 'participants', 'sites', 'password_reset_tokens', 'sessions', 'users', 'jobs', 'job_batches', 'failed_jobs', 'cache', 'cache_locks'] as $table) {
                if (Schema::hasTable($table)) {
                    DB::table($table)->delete();
                }
            }
        });
        $this->info('FlakFlak data deleted. Sign in again and create a new site.');
        $this->line('Existing embed codes no longer work. Browser drafts and backups are not remotely erased.');
    } finally {
        if (! $alreadyDown) {
            $this->call('up');
        }
    }
})->purpose('Interactively delete all standalone FlakFlak application data and attachments');
