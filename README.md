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

Local MySQL uses `flakflak_local`. Credentials and the MAMP socket stay in ignored `api/.env`. Set `MAIL_MAILER=log` and `LOG_LEVEL=debug` for local magic-link email; read messages with `tail -f api/storage/logs/laravel.log`. Generate APP_KEY with `php artisan key:generate` for a fresh setup. Owner-key access is retired. Name-only feedback is available only on sites explicitly created as Public.

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

The dashboard requires a verified email account. Private sites require per-site invitations, while Public sites let widget visitors enter a name without registering. Email magic links replace the owner-key dashboard. See [Authentication and rollout](docs/AUTHENTICATION.md) for local mail-log testing, invitations, reset behavior, and the ServerPilot ownership cutover. Existing accounts/sites are not reset by deployment.

## Feedback categories

Each comment has an independent category (General, Content, Design, Functionality) and status (Open, Review, Closed). New comments start as Open / General. Choose a category in the composer or change it in an existing thread. Members can update categories; changes are versioned and appear in history/activity. The sidebar's Category filter narrows the current-page comment list; all-page status totals and completion progress remain site-wide.

The category migration preserves existing comments. Content statuses become Open with category Content, and all other existing comments default to General. Earlier Content status history remains historical text. Dot colors indicate workflow status, not category. Progress is Closed divided by total comments across all categories. Run `php artisan migrate` locally; normal ServerPilot deployment runs the migration automatically. Reload existing widget pages after deploying this change so cached builds stop offering Content as a status.

## Comment numbers

Comment labels are permanent site-wide numbers, separate from database IDs: two dots on one page can be #1 and #2, and the next dot on another page of that same site is #3. A different site starts at #1. Numbers stay the same when a comment changes status, category, position, or page layout. Deleting a comment leaves a gap; its number is never reused. Reset feedback retains the site's sequence too. Starting over with a new site starts a new sequence.

The migration assigns existing comments numbers in creation order, breaking timestamp ties by ID. IDs, replies, attachments, read tracking, and existing `#flakflak-comment-ID` links are preserved. New copy links continue using internal IDs so old and new links share the same stable format. Search by # uses the visible site number. Deployment runs the migration automatically; reload embedded pages afterward to see the new labels.

## Public and private project modes

Choose an access mode when creating a site. **Private is the default** and keeps the verified email + invitation flow. **Public** lets anyone on an allowed website enter a name to view feedback, add comments/replies/files, update status/category, and reposition dots. Names are not verified and do not grant another contributor's edit permissions. Public visitors have no dashboard, site-settings, invitation-management, or reset permissions.

The choice is permanent: there is no mode toggle after creation, and the API rejects mode changes. Create a separate site if a different mode is needed. Existing sites remain Private when the migration runs. Public visitors do not need SMTP or an account; owners and invited members still use email sign-in to manage sites. Public widgets offer optional member sign-in for those accounts.

A public name session lasts up to 30 days in that browser, is scoped to the exact website origin and site, and can be revoked with Sign out of this site. It cannot access a private site. Attachments still use bearer-authorized fetches; there are no unauthenticated permanent file links. Reset feedback removes public visitor identities, so they enter a name again. Public access remains available even after an invited account is removed, because anyone may join by name.
