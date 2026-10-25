# Testing

API feature tests run with PHP 8.2 and an in-memory SQLite database. They cover
site boundaries, name collisions, guest credentials, duplicate saves/replies,
URL normalization, status conflicts, resolution notes, MIME validation, signed
attachment access, and site-wide data boundaries. Never run migrate:fresh on
your development or production database.

Browser tests use installed Chrome (override CHROME_BIN if needed), compiled
assets, and a separate temporary SQLite-backed PHP API. Playwright intercepts
the three localhost domains and serves their actual build files; API requests
are forwarded to the temporary server. This checks cross-origin browser behavior
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

## Verified on this local setup

- PHP 8.2.0: 11 API tests, 82 assertions; Composer platform requirements pass.
- Node 22.19.0: three anchor/deployment regression tests and both frontend type checks pass.
- Chrome: guest comments, keyboard replies, status conflicts (API), image upload/loading, gallery, resolutions, reload persistence, desktop/mobile bounds and a second origin.
- MAMP static dashboard and embed hosts serve their builds.
- MAMP folder access is resolved. The normal API domain returns its service identity, a healthy MySQL-backed response from /api/v1/health, and the seeded demo-site configuration with the expected allowed origins.
- Real ServerPilot deployment, other browsers and full WordPress-plugin feature parity remain unchecked in CHECKLIST.md.

User verification: comments, replies, attachments, status changes, and dot positioning were also tested successfully through the normal MAMP domains.
