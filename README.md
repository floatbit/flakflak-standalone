# FlakFlak standalone

One repository: Laravel 12 / PHP 8.2 API, Vue 3 dashboard, TypeScript widget.
This project is independent of the existing WordPress plugin. It neither loads
WordPress nor connects to the WordPress database.

## Local setup

Requirements: PHP **8.2+** with PDO MySQL/SQLite, mbstring, fileinfo, DOM and GD;
Composer; Node **22.12+**; npm; MySQL 5.7+ (use MySQL 8 for a new production server).
Composer's platform is pinned to PHP 8.2.0 so resolving dependencies with newer
PHP does not silently raise the minimum runtime. Use a maintained PHP 8.2 patch
release on production.

```bash
cd /Users/chrismanlapid/Desktop/htdocs/flakflak
npm ci
cd api
/Applications/MAMP/bin/php/php8.2.0/bin/php /opt/homebrew/bin/composer install
# For a fresh installation, copy .env.example to .env and fill in your settings.
# Existing local .env is already configured; do not overwrite it.
/Applications/MAMP/bin/php/php8.2.0/bin/php artisan migrate
/Applications/MAMP/bin/php/php8.2.0/bin/php artisan db:seed
cd ..
npm run build
```

Local MySQL uses `flakflak_local`. Credentials and the MAMP socket stay in ignored `api/.env`. Set `MAIL_MAILER=log` and `LOG_LEVEL=debug` for local magic-link email; read messages with `tail -f api/storage/logs/laravel.log`. Generate APP_KEY with `php artisan key:generate` for a fresh setup. Owner-key and name-only access are retired.

Set these MAMP document roots and select **PHP 8.2 for the API host**. Where MAMP provides separate Site folder and Document root controls, set the API Site folder to `flakflak/api` and select `public` as its Document root subfolder so PHP retains access to framework files above public:

| Host | Document root |
| --- | --- |
| api-flakflak.localhost | `/Users/chrismanlapid/Desktop/htdocs/flakflak/api/public` |
| app-flakflak.localhost | `/Users/chrismanlapid/Desktop/htdocs/flakflak/app/dist` |
| embed-flakflak.localhost | `/Users/chrismanlapid/Desktop/htdocs/flakflak/embed/dist` |

Never serve the API repository root: only `api/public` is public. Rebuild after
frontend edits. Alternatively `npm run dev:app` starts Vite on port 5173; allow
that dashboard origin in the API environment if using it. `scripts/local-api.sh`
starts a temporary PHP API on port 8081; update frontend URLs and allowed origins
when using alternative ports. Nothing is deployed by a local build or Git push.

## Try it

1. Open `http://app-flakflak.localhost`, request an email sign-in link, open it from the local mail log, and click Confirm sign-in.
2. Set your display name. Create a site, or claim the local demo after signing in: `cd api && php artisan flakflak:claim your@email.example` (use MAMP PHP 8.2 on this machine).
3. Add the dashboard and embed demo origins to the site's allowed addresses, then open its demo from the dashboard.
4. Shift-click page content, sign in through the popup, click Connect widget, and save a comment. Add a reply or file.
5. Open the demo from the second origin to test a separate site-scoped widget session.
6. In the owner's Members section invite a second email, copy its invitation link, and accept with a different browser profile. Registration alone does not grant site access.
7. Create another site for WordPress or Drupal and copy its generated embed snippet into the allowed website.

The widget does not rely on host jQuery, Vue, or CSS. It uses Shadow DOM for its
UI and DOM anchors for dots. Missing targets fall back to saved document
coordinates. Cross-origin iframe contents require their own installation.
All feedback routes require a verified account and per-site membership. Owners manage site settings and invitations; Members can leave feedback and edit their own contributions. Site IDs and origin allowlists are not credentials. Widget sessions are limited to one site/origin; account sign-in uses a verified popup handoff without third-party cookies. Private attachments are fetched with authentication and rendered as blob URLs. See [Authentication](docs/AUTHENTICATION.md) for permissions, session lifetimes, reset behavior, and production cutover.

## Tests

```bash
npm run typecheck
npm run build
cd api && /Applications/MAMP/bin/php/php8.2.0/bin/php artisan test
```

API tests use an in-memory SQLite database. Browser tests use built frontend
files and a temporary API, not your WordPress site. See `docs/TESTING.md`.

## Deployment

See `docs/DEPLOYMENT.md`. The root `deploy.sh` is intended to run over SSH on a
ServerPilot server after one-time setup. Production credentials, uploads and
logs live outside releases. The Git remote is `floatbit/flakflak-standalone`. Production updates are deployed explicitly; pushing alone does not publish them.

## Implementation status

The core embedded review tools and WordPress reference layout are ported: themes,
sidebar settings, saturated status dots, comments/replies/files, drafts, unread
tracking, review navigation, target movement/reattachment and ownership actions.
Graphite is the default. The retained palette and classic themes share the same review workflows.

New widgets request `reply_limit=2` for thread responses. The API retains its
original complete response for older loaded widgets, while exposing cursor-based
older-reply pages to new builds. The email-account cutover intentionally blocks old guest-based widgets and requires a page reload.

See `CHECKLIST.md` for remaining deployment
and production/CMS/device verification still needed. The existing WordPress
plugin and its database remain independent and unchanged.

## Private email accounts

The standalone app now requires verified email accounts and per-site invitations. Email magic links replace the owner-key dashboard and name-only widget. See [Authentication and rollout](docs/AUTHENTICATION.md) for local mail-log testing, invitations, reset behavior, and the ServerPilot ownership cutover. Existing accounts/sites are not reset by deployment.
