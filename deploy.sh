#!/usr/bin/env bash
# Run over SSH from the standalone repository. No ServerPilot or DNS mutation.
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${FLAKFLAK_DEPLOY_CONFIG:-$PROJECT_DIR/.deploy.env}"
if [[ ! -f "$CONFIG_FILE" ]]; then echo 'Copy .deploy.env.example to .deploy.env and configure it first.' >&2; exit 1; fi
# This is a private, owner-maintained shell configuration file.
source "$CONFIG_FILE"
: "${DEPLOY_ROOT:?}" "${API_PUBLIC:?}" "${APP_PUBLIC:?}" "${EMBED_PUBLIC:?}" "${API_HEALTH_URL:?}" "${VITE_API_URL:?}" "${VITE_EMBED_URL:?}"
PHP_BIN="${PHP_BIN:-php}"; COMPOSER_BIN="${COMPOSER_BIN:-$(command -v composer)}"; DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
for tool in git npm rsync tar curl; do command -v "$tool" >/dev/null || { echo "Missing command: $tool" >&2; exit 1; }; done
"$PHP_BIN" -r 'exit(PHP_VERSION_ID >= 80200 ? 0 : 1);' || { echo 'PHP 8.2 or newer is required.' >&2; exit 1; }
[[ -f "$COMPOSER_BIN" ]] || { echo "Composer executable not found: $COMPOSER_BIN" >&2; exit 1; }
"$PHP_BIN" "$COMPOSER_BIN" --version >/dev/null
for public_path in "$API_PUBLIC" "$APP_PUBLIC" "$EMBED_PUBLIC"; do
 [[ "$public_path" = /*/public ]] || { echo 'Public targets must be absolute ServerPilot public paths.' >&2; exit 1; }
 [[ ! -e "$public_path" || -L "$public_path" ]] || { echo "Move the initial placeholder directory aside before setup: $public_path" >&2; exit 1; }
done
[[ "$API_PUBLIC" != "$APP_PUBLIC" && "$API_PUBLIC" != "$EMBED_PUBLIC" && "$APP_PUBLIC" != "$EMBED_PUBLIC" ]] || { echo 'Public targets must be different.' >&2; exit 1; }
[[ -f "$DEPLOY_ROOT/shared/api.env" ]] || { echo 'Create the production environment file at DEPLOY_ROOT/shared/api.env.' >&2; exit 1; }
if [[ "${1:-}" == --check ]]; then echo 'Deployment configuration and required commands checked. No release deployed.'; exit 0; fi
[[ -n "${BACKUP_COMMAND:-}" ]] || { echo 'Configure BACKUP_COMMAND before running production migrations.' >&2; exit 1; }
cd "$PROJECT_DIR"
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit or remove working-tree changes before deployment.' >&2; exit 1; }
[[ "$(git branch --show-current)" == "$DEPLOY_BRANCH" ]] || { echo "Check out $DEPLOY_BRANCH before deployment." >&2; exit 1; }
mkdir -p "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/shared"
LOCK_DIR="$DEPLOY_ROOT/.deploy-lock"
mkdir "$LOCK_DIR" 2>/dev/null || { echo 'Another deployment is running (or its lock needs checking).' >&2; exit 1; }
OLD_API="$(readlink "$API_PUBLIC" || true)"; OLD_APP="$(readlink "$APP_PUBLIC" || true)"; OLD_EMBED="$(readlink "$EMBED_PUBLIC" || true)"; SWITCHED=0
atomic_link(){ local target="$1" destination="$2"; ln -s "$target" "$destination.next.$$"; mv -Tf "$destination.next.$$" "$destination"; }
rollback(){
 if [[ "$SWITCHED" == 1 ]]; then
  [[ -z "$OLD_API" ]] || atomic_link "$OLD_API" "$API_PUBLIC"
  [[ -z "$OLD_APP" ]] || atomic_link "$OLD_APP" "$APP_PUBLIC"
  [[ -z "$OLD_EMBED" ]] || atomic_link "$OLD_EMBED" "$EMBED_PUBLIC"
  echo 'Previous public links restored where available. Database migrations were not reversed.' >&2
 fi
}
trap 'code=$?; if [[ $code != 0 ]]; then rollback; fi; rmdir "$LOCK_DIR"; exit "$code"' EXIT
# Fast-forward only: never discard local work or rewrite Git history.
git fetch origin "$DEPLOY_BRANCH"
git merge --ff-only "origin/$DEPLOY_BRANCH"
REVISION="$(git rev-parse --short=12 HEAD)"
RELEASE="$DEPLOY_ROOT/releases/$(date -u +%Y%m%d%H%M%S)-$REVISION"
mkdir "$RELEASE"
git archive HEAD | tar -x -C "$RELEASE"
ln -s "$DEPLOY_ROOT/shared/api.env" "$RELEASE/api/.env"
mkdir -p "$DEPLOY_ROOT/shared/storage"
rsync -a --ignore-existing "$RELEASE/api/storage/" "$DEPLOY_ROOT/shared/storage/"
rm -r "$RELEASE/api/storage"
ln -s "$DEPLOY_ROOT/shared/storage" "$RELEASE/api/storage"
cd "$RELEASE"
"$PHP_BIN" "$COMPOSER_BIN" install --working-dir=api --no-dev --no-interaction --prefer-dist --optimize-autoloader
npm ci --no-audit --no-fund
export VITE_API_URL VITE_EMBED_URL
npm run build
# Back up before running additive migrations; do not automatically run migration rollbacks.
bash -c "$BACKUP_COMMAND"
(cd api && "$PHP_BIN" artisan migrate --force && "$PHP_BIN" artisan config:cache && "$PHP_BIN" artisan route:cache && "$PHP_BIN" artisan view:cache)
# Keep old immutable widget runtimes available after switching to a new release.
mkdir -p "$DEPLOY_ROOT/shared/widget-runtimes"
rsync -a "$RELEASE/embed/dist/" "$DEPLOY_ROOT/shared/widget-runtimes/" --exclude=widget.js --exclude=demo.html --exclude=.htaccess
rsync -a "$DEPLOY_ROOT/shared/widget-runtimes/" "$RELEASE/embed/dist/"
# Keep dashboard assets from previous releases for browsers with an older HTML document.
mkdir -p "$DEPLOY_ROOT/shared/dashboard-assets"
rsync -a "$RELEASE/app/dist/assets/" "$DEPLOY_ROOT/shared/dashboard-assets/"
rsync -a "$DEPLOY_ROOT/shared/dashboard-assets/" "$RELEASE/app/dist/assets/"
# These three filesystem switches are sequential; API compatibility is required across releases.
SWITCHED=1
atomic_link "$RELEASE/api/public" "$API_PUBLIC"
atomic_link "$RELEASE/app/dist" "$APP_PUBLIC"
atomic_link "$RELEASE/embed/dist" "$EMBED_PUBLIC"
curl --fail --silent --show-error --retry 3 --retry-delay 2 "$API_HEALTH_URL" >/dev/null
curl --fail --silent --show-error --retry 3 --retry-delay 2 "${VITE_EMBED_URL}" >/dev/null
curl --fail --silent --show-error --retry 3 --retry-delay 2 "${APP_HEALTH_URL:-${API_HEALTH_URL%/api/v1/health}}" >/dev/null
SWITCHED=0
printf 'Deployed release %s\n' "$REVISION"
