# Testing

API feature tests run with PHP 8.2 and an in-memory SQLite database. They cover
site boundaries, name collisions, guest credentials, duplicate saves/replies,
URL normalization, status conflicts, resolution notes, MIME validation, signed
attachment access, and site-wide data boundaries. Never run migrate:fresh on
your development or production database.

Browser tests use installed Chrome (override CHROME_BIN if needed), optional Playwright Firefox/WebKit, compiled
assets, and a separate temporary SQLite-backed PHP API. Playwright intercepts the three localhost domains and serves their actual build
files. Its test loader points widget requests directly at the temporary API so
multipart bytes use native browser networking. Dashboard JSON requests are
forwarded separately. Chromium's isolated test context grants loopback access
for these local test origins; this changes no real browser settings. This checks cross-origin browser behavior
without depending on your MAMP virtual-host settings. It does not verify those
settings, TLS, reverse proxies, other browsers, or a real ServerPilot deployment.

```bash
# Terminal 1, from api/: isolated browser-test database only.
touch /private/tmp/flakflak-browser.sqlite
DB_CONNECTION=sqlite DB_DATABASE=/private/tmp/flakflak-browser.sqlite DB_SOCKET= \
 /Applications/MAMP/bin/php/php8.2.0/bin/php artisan migrate
DB_CONNECTION=sqlite DB_DATABASE=/private/tmp/flakflak-browser.sqlite DB_SOCKET= \
 /Applications/MAMP/bin/php/php8.2.0/bin/php -S 127.0.0.1:8081 -t public
# Terminal 2, from the repository root:
npm run build
npm run test:browser
```

Browser test feedback is stored only in that disposable SQLite database. Its
uploaded files use the API's local private storage. Remove the disposable database
and test upload subdirectories after stopping the test server if no longer needed.

## Browser engines and reference checks

```bash
npx playwright install firefox webkit
npm run test:browsers
```

The browser suite covers the full feedback workflow; settings persistence and
font isolation; sidebar/panel bounds; ownership actions; reattachment and dragging;
reply pagination; unread state; per-page draft recovery; and reference screenshots
for a 320px sidebar/composer, 350px thread, original dot colors and site totals.
Chromium and Firefox test a lost upload response; WebKit tests a failed native
upload request because replaying intercepted multipart data changes its bytes.
Server-side idempotency is also covered by PHP tests.

API tests now include ownership by identity, monotonic read snapshots, status/move
conflicts, query batching for 50 comments, independent rate limits and backward
compatibility of older full-thread replies. They run under PHP 8.2 with an isolated
in-memory SQLite database. No WordPress database is used.

MAMP's folder-access issue is resolved: the normal API domain returns a healthy
MySQL-backed response and seeded demo configuration. The user also verified
comments, replies, uploads, statuses and dot positioning through normal MAMP hosts.
Real ServerPilot deployment, physical devices, actual Safari and CMS integration
verification are still separate checklist items.

Latest verification (standalone 0.2.0): PHP 8.2 suite passes 18 tests / 183 assertions; Node regression suite passes 7 tests; Chromium, Firefox and WebKit pass all 18 browser workflows including WordPress visual references. Frontend type checks and production builds pass. Original WordPress plugin working tree remains clean.
