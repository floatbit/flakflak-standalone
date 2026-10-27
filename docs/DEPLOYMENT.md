# ServerPilot deployment

## One-time setup

1. Create a dedicated FlakFlak system user and three ServerPilot apps under that
   user: flakflak-api, flakflak-app and flakflak-embed. Assign the corresponding
   production domains, configure DNS, and enable SSL. Select PHP 8.2 for the API.
2. Create a production MySQL database and a dedicated database user. Local root
   credentials are not used in production. Configure database and attachment
   backups and test restoring them.
3. Install/verify Git, Composer, Node 22.12+, npm, rsync and curl. The deployment
   script uses GNU/Linux `mv -T`, as available on ServerPilot's Ubuntu server.
4. Clone the one repository outside all web roots, for example ~/flakflak. Set its
   origin and main branch. Releases will be built in ~/flakflak-deploy/releases.
5. Copy .deploy.env.example to .deploy.env and replace every example path/domain.
   COMPOSER_BIN must point to the Composer PHP executable/PHAR. Configure a real
   BACKUP_COMMAND: its successful exit must mean a recoverable backup exists.
6. Create DEPLOY_ROOT/shared/api.env from api/.env.production.example. Fill in
   database details, a generated Laravel APP_KEY, and production SMTP/sender credentials. Keep APP_DEBUG=false. Set file permissions to owner-only (600).
7. Move each app's initial public placeholder directory aside. The script creates
   public symlinks to release subdirectories. It refuses to replace a real public
   directory automatically. App paths and their parents must be writable by the
   dedicated system user. Do not point domains at the repository root.
8. Confirm PHP upload_max_filesize=10M+ and post_max_size=12M+, and web-server body
   limits that allow uploads. API .user.ini supplies these PHP values where PHP-FPM
   permits them. Confirm storage and bootstrap/cache are writable. Enable PHP
   OPcache timestamp validation or arrange a PHP-FPM reload for every deployment.
9. Run ./deploy.sh --check, then ./deploy.sh. Check the dashboard and embed manually.

## Routine updates

Test locally, commit and push. Over SSH, cd to the server's repository and run
./deploy.sh. It fast-forwards from origin/main, prepares a release, installs locked
dependencies, builds the two frontends, runs the configured backup, applies
migrations, caches Laravel configuration, switches public links, and checks the
API/dashboard/widget URLs. An interrupted deployment leaves a lock to inspect.
No automatic deployment happens just because you push to Git.

Deployment switches the three public links sequentially, not as one atomic group.
Keep APIs compatible with both current and previous widget/dashboard versions.
Old immutable assets are retained. Do not add destructive migrations to routine
releases; separate schema removal from the code that stops using the old fields.

## Rollback and first-deploy limits

On a post-switch error, the script restores previous public symlinks where they
exist. On a first deployment there may be no previous links to restore. Database
migrations and shared storage are not rolled back. Restoring a backup can lose
feedback created since the backup, so use an explicit recovery procedure.

Keep the previous release directories. For a manual rollback, point all three
public symlinks to the matching previous release directories using atomic symlink
replacement, then health-check. Restore the database only when necessary and
with a reviewed recovery plan. Never run migrate:rollback blindly in production.

This repository provides deployment tooling; real ServerPilot paths, SSL,
symlink permissions, backup behavior, PHP-FPM caching and rollback still require
staging verification before a public launch. No production connection has been made.

## Email-account cutover

Read [AUTHENTICATION.md](AUTHENTICATION.md) before deploying the account release. Configure production email before deployment, sign in with your owner email, claim legacy sites with `flakflak:claim`, and reset old feedback explicitly. The former owner key and guest sessions are retired. Private media now requires membership. Configure COMPOSER_BIN with the real PHAR (on ServerPilot `/opt/sp/bin/composer.phar`), not `/usr/bin/composer`, which may be a shell wrapper.
