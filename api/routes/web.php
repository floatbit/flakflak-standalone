<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['service' => 'FlakFlak API', 'version' => 'v1']));
