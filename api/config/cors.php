<?php

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // SiteOrigin middleware checks each site's origin; no credential cookies are used.
    'allowed_origins' => ['*'],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['Content-Type', 'Authorization', 'Accept', 'X-Feedback-Version'],
    'exposed_headers' => [], 'max_age' => 600, 'supports_credentials' => false,
];
