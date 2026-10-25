<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    public function test_api_identifies_itself(): void
    {
        $this->get('/')->assertOk()->assertJsonPath('service', 'FlakFlak API');
    }
}
