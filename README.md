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

Local MySQL uses `flakflak_local`. Its local-only credentials and MAMP socket
are in `api/.env`, not in Git. `FLAKFLAK_OWNER_KEY` is a random private key in
that same file: paste its value into the dashboard to manage sites. The key is
kept in tab memory, never added to widget code. Reviewer access is name-only.
For a fresh setup generate APP_KEY using `php artisan key:generate` and an owner
key using `php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'`.

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

1. Open `http://app-flakflak.localhost` and enter the owner key from `api/.env`.
2. Select **Local demo workspace** (created by the local-only seeder).
3. Open `http://app-flakflak.localhost/demo.html?site=6d19cd1e-9651-4c3b-96c9-6052ec752f21`.
4. Shift + click page content, enter a name, and save a comment. Add a reply or file.
5. Open `http://embed-flakflak.localhost/demo.html?site=6d19cd1e-9651-4c3b-96c9-6052ec752f21`
   to test a second origin. Page lists and progress are site-wide; dots belong to
   the specific page. Guest identities are independently stored per host origin.
6. Create another site for WordPress or Drupal, enter its exact allowed origin
   (scheme, host, and port), and copy the generated embed snippet into that site.

The widget does not rely on host jQuery, Vue, or CSS. It uses Shadow DOM for its
UI and DOM anchors for dots. Missing targets fall back to saved document
coordinates. Cross-origin iframe contents require their own installation.
Names are display labels, never credentials; each guest gets a site-scoped token
stored as a hash on the server. Guest sessions last 90 days. Clearing browser
storage or switching browser/device creates a new guest. Site IDs and domain
allowlists are not privacy controls; anonymous feedback is readable by callers
that know the site ID. Rate limits and domain checks limit misuse but do not
establish a verified identity. Only owner-key requests can manage sites.

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
logs live outside releases. There is no Git remote configured yet and no
production deployment has been performed.

## Implementation status

See `CHECKLIST.md` for delivered features, remaining parity work, and deployment
verification that still requires your production server. This is the first
standalone local milestone, not a claim of full WordPress-plugin parity.
