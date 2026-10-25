#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../api"
PHP_BIN="${FLAKFLAK_PHP_BIN:-/Applications/MAMP/bin/php/php8.2.0/bin/php}"
exec "$PHP_BIN" artisan serve --host=127.0.0.1 --port="${FLAKFLAK_API_PORT:-8081}"
