# Email accounts and site invitations

## Access model

All feedback is private. Every account must verify its email with a single-use magic link. Each site has one Owner and invited Members. A newly registered account can create its own site, but cannot access somebody else's site without accepting an invitation.

Owners manage site settings, invitations, member removal, all feedback, and feedback reset. Members can read feedback, add comments/replies/files, reposition dots, change statuses, and edit/delete only their own contributions. There is no public/name-only feedback, Reviewer role, Viewer role, or social login in this release.

The Members section displays Pending invitations and Accepted members. Copy invitation link shares a link to an invitation, not a sign-in credential. The recipient must verify the invited email and explicitly accept. Resend replaces the old invitation link. Delete invitation invalidates the link and removes its pending row. Accepted members instead have Remove member, which immediately removes server access and invalidates site tokens. Owners cannot remove themselves.

## Local testing

The normal local domains remain:

- http://app-flakflak.localhost
- http://api-flakflak.localhost
- http://embed-flakflak.localhost

Run the additive migration with MAMP PHP 8.2 from `api/`:

```bash
/Applications/MAMP/bin/php/php8.2.0/bin/php artisan migrate
```

The widget build uses `VITE_DASHBOARD_URL`; the default is the local app origin. `embed/.env.example` documents it. Rebuild from the repository root with `npm run build` after changing frontend environment variables.

Local `api/.env` should use `MAIL_MAILER=log` and `LOG_LEVEL=debug`. Emails are not sent externally. To read the invitation and magic links in your local terminal:

```bash
tail -f api/storage/logs/laravel.log
```

These local logs contain temporary links. Do not paste them into chat, commit logs, or expose them over a public URL. For an inbox interface, point Laravel SMTP settings at a local Mailpit installation; its usual SMTP port is 1025 and web inbox port is 8025. Mailpit is optional and is not installed by this project.

1. Open the dashboard and enter your email. Open the link from the development mail log and click Confirm sign-in. GET/opening a link does not consume it.
2. Enter a display name on first registration.
3. Create a site, or claim an existing unowned local site with the command below.
4. Add the actual website origin (scheme, host, and port) to the site's allowed origins. The local dashboard origin must also be allowed when testing its demo page.
5. Select the site, invite a second email in Members, and use Copy invitation link.
6. Open that invitation in a different browser profile/private window, request a magic link, verify it, enter a name, and explicitly accept. Confirm Pending becomes Accepted in the owner's Members section after selecting/refreshing that site.
7. On an embedded website, click FlakFlak or Shift-click. Click Sign in to open the first-party dashboard popup. After email sign-in (which may open a different tab), return to that popup and click Connect widget. Your dot placement is retained.
8. If the popup connection is blocked, use Open sign-in in a new tab, then paste the short-lived connection code into the widget dialog. This code only works for the original website's challenge and site.
9. Test an uninvited account: it must not obtain comments, search results, activity, pages, or attachment bytes.

## Existing sites and name-only data

The old owner key and guest tokens no longer grant access. Existing anonymous feedback is not assigned to accounts by name or email. It can be discarded using Reset feedback; migrations do not silently delete it.

After signing in with your owner email, from `api/` run:

```bash
php artisan flakflak:claim you@example.com
```

This claims only sites without an owner. Add `--site=SITE_UUID` to limit it. Use the explicit `--reset-feedback` flag only when you want to scrub the claimed sites' old feedback immediately. You can instead reset each site through its dashboard Danger zone after inspecting it.

## Reset feedback

The owner types the site name exactly to confirm. The reset removes comments/dots, replies/status history, uploaded files, activity, read tracking, page records, and anonymous participants for that site. It retains the site UUID/embed code, allowed origins, registered accounts, memberships, and invitations.

A per-site feedback version changes. Connected widgets clear old local draft text/files and upload queues on their next successful connection. Writes from an already-open stale widget carry the old version and are rejected until it reconnects. Browser storage that is offline cannot be remotely erased; it is invalidated when that widget connects again. Existing backups keep old copies until their retention period expires.

File deletion happens before database removal. If filesystem cleanup fails, the reset fails so records remain available for retry; any files already removed cannot be restored without a backup. Feedback writes/reset are serialized by a site-row lock.

## Sessions and private media

Account sessions are opaque random bearer tokens, stored hashed server-side and in first-party app browser storage for up to 30 days. Magic links expire after 15 minutes and are single-use. Invitation links expire after 7 days internally while their rows remain Pending. Resend creates a fresh link.

Widget sessions are scoped to a site and exact allowed origin for 24 hours, with membership checked on every API request. A popup sends a two-minute, single-use code to the exact opener origin, bound to a SHA-256 verifier challenge. It never shares the dashboard account token with an embedded website. Third-party cookies are not required. Sign out of this site revokes the current widget token; dashboard Sign out revokes all that account's sessions and handoffs.

Attachments are fetched with the same authenticated session and rendered as local blob URLs. Public signed attachment URLs from older builds no longer work. Media responses use `Cache-Control: private, no-store`. Membership removal immediately blocks subsequent fetches; already downloaded content cannot be remotely recalled.

## Production rollout on ServerPilot

This release intentionally replaces the old public/name-only API. Coordinate a reload of existing widgets after deployment; older cached widgets will no longer have access. Do not deploy before production email delivery is ready.

1. Configure a verified sender and SMTP service in `/srv/users/serverpilot/flakflak-deploy/shared/api.env`:

```dotenv
MAIL_MAILER=smtp
MAIL_HOST=YOUR_PROVIDER_HOST
MAIL_PORT=587
MAIL_SCHEME=smtp
MAIL_USERNAME=YOUR_PROVIDER_USERNAME
MAIL_PASSWORD="YOUR_PROVIDER_PASSWORD"
MAIL_FROM_ADDRESS=YOUR_VERIFIED_SENDER
MAIL_FROM_NAME=FlakFlak
```

Use your provider's actual port/TLS settings (`smtps` commonly uses port 465). Never commit these credentials. Production rejects the log/array mail drivers for sign-in email.

2. Confirm `FLAKFLAK_DASHBOARD_ORIGIN=https://app.flakflak.com`. The `.deploy.env` build setting `VITE_DASHBOARD_URL=https://app.flakflak.com` is documented; deploy.sh also defaults it from APP_HEALTH_URL.
3. Push the tested code, then SSH and run `nvm use 22` and `bash deploy.sh`. Existing production backups run before the additive migration. No manual table creation is needed.
4. Sign in with your owner email and set your display name.
5. From the active API release, claim existing unowned sites:

```bash
cd "$(dirname "$(readlink -f /srv/users/serverpilot/apps/flakflak-api/public)")"
/opt/sp/php8.2/bin/php artisan flakflak:claim you@example.com
```

6. Use each site's Reset feedback action to scrub old feedback, then send/copy invitations and test acceptance and private media from an invited account.
7. Check the API log and email provider delivery status if a message does not arrive. Do not share magic links or Authorization headers.

Expired authentication records can be pruned with `php artisan flakflak:prune-auth`. This command is registered daily with Laravel's scheduler; enable `schedule:run` cron against the current API release to automate it, or run it manually. Expiration is enforced even without the scheduler.

Production deployment, SMTP setup, and account claiming must be done deliberately; this implementation does not change the live server or delete its feedback automatically. Reverting to the old public build after cutover would reintroduce public access, so plan a forward fix rather than blindly rolling back authentication.

## Start completely fresh with nuke.sh

Run `bash nuke.sh` from the standalone repository for its local API, or `bash nuke.sh --live` on ServerPilot to target the active deployed API using `.deploy.env`. You can set `PHP_BIN` to the PHP 8.2 executable if it is not on your PATH. The script displays the environment, database, and API folder before asking **Are you sure you want to delete everything?** The default answer is No. There is no skip-confirmation flag.

Yes permanently deletes all accounts, sites, invitations, sessions, feedback, uploaded attachments, queues, and application cache. Code, environment configuration, database structure/migration history, logs, and backups remain. This is the entire standalone installation, not one site. Existing embed codes stop working; sign in again, create new sites, and install their new embed codes. No ownership claim is needed after a complete reset. The WordPress plugin is unaffected.

Take a backup first if needed and pause external queue workers/scheduled jobs during a live reset. The command temporarily enables API maintenance mode and restores its previous state afterward. File cleanup precedes database deletion; a failure may leave some files removed. Browser drafts, downloaded files, mail-provider records, logs and backups cannot be remotely erased by this script. It is never run by deploy.sh. Test it only against disposable data before using it on an installation you want to erase.
