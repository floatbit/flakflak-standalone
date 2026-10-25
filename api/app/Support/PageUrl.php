<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

class PageUrl
{
    public static function origin(string $url): string
    {
        $parts = parse_url($url);
        if (! $parts || ! isset($parts['scheme'], $parts['host']) || ! in_array(strtolower($parts['scheme']), ['http', 'https']) || isset($parts['user']) || isset($parts['pass'])) {
            throw ValidationException::withMessages(['url' => 'Enter a valid HTTP or HTTPS URL without credentials.']);
        }
        $scheme = strtolower($parts['scheme']);
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);

        return $scheme.'://'.strtolower($parts['host']).(($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80) ? '' : ':'.$port);
    }

    public static function canonical(string $url): string
    {
        $origin = self::origin($url);
        $parts = parse_url($url);
        $query = [];
        parse_str($parts['query'] ?? '', $query);
        foreach (array_keys($query) as $key) {
            if (str_starts_with(strtolower($key), 'utm_') || in_array(strtolower($key), ['fbclid', 'gclid'])) {
                unset($query[$key]);
            }
        }
        ksort($query);
        $suffix = http_build_query($query);

        return $origin.($parts['path'] ?? '/').($suffix !== '' ? '?'.$suffix : '');
    }
}
