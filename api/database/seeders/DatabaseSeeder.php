<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment('local')) {
            return;
        }
        DB::table('sites')->insertOrIgnore(['id' => '6d19cd1e-9651-4c3b-96c9-6052ec752f21', 'name' => 'Local demo workspace', 'origins' => json_encode(['http://app-flakflak.localhost', 'http://embed-flakflak.localhost']), 'created_at' => now(), 'updated_at' => now()]);
    }
}
