#!/usr/bin/env bash
# Reset standalone FlakFlak data; never run automatically during deployment.
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$PROJECT_DIR/api"
PHP_BIN="${PHP_BIN:-php}"
case "${1:-}" in
  --live)
    CONFIG_FILE="${FLAKFLAK_DEPLOY_CONFIG:-$PROJECT_DIR/.deploy.env}"
    [[ -f "$CONFIG_FILE" ]] || { echo 'Deployment configuration not found.' >&2; exit 1; }
    source "$CONFIG_FILE"
    [[ -L "${API_PUBLIC:-}" && -f "$API_PUBLIC/../artisan" ]] || { echo 'Active API release not found. Deploy first.' >&2; exit 1; }
    API_DIR="$(dirname "$(cd "$API_PUBLIC" && pwd -P)")"
    ;;
  '')
    if ! command -v "$PHP_BIN" >/dev/null 2>&1 && [[ -x /Applications/MAMP/bin/php/php8.2.0/bin/php ]]; then
      PHP_BIN=/Applications/MAMP/bin/php/php8.2.0/bin/php
    fi
    ;;
  *) echo 'Usage: bash nuke.sh [--live]' >&2; exit 1 ;;
esac
[[ -f "$API_DIR/vendor/autoload.php" ]] || { echo 'API dependencies are missing.' >&2; exit 1; }
cd "$API_DIR"
exec "$PHP_BIN" artisan flakflak:nuke
