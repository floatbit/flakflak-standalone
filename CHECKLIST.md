# Standalone implementation checklist

## Foundation
- [x] Separate project; existing WordPress plugin unchanged.
- [x] Laravel 12 and Composer platform pinned to PHP 8.2.
- [x] Vue 3 / TypeScript dashboard, TypeScript / Shadow DOM widget.
- [x] Shared typed API client, environment templates and lockfiles.
- [x] Local MySQL connection and new migrations in flakflak_local.
- [x] Separate API, dashboard and embed build targets.
- [x] Verify MAMP's selected PHP and all three updated document roots; API health and demo configuration respond through the normal local domain.

## First local milestone
- [x] Owner-key dashboard: list/create sites, edit names and allowed origins.
- [x] Copyable embed snippet and two demo sites on separate origins.
- [x] Name-only guest identities with hashed site-scoped credentials.
- [x] Cross-origin requests, site isolation, validation and rate limiting.
- [x] Page URL normalization; meaningful query parameters preserved.
- [x] Shift-click and click-to-place comments; responsive dots and missing-target fallback.
- [x] Replies, last-two-replies view, statuses and optional resolution notes.
- [x] Version conflict checks on status updates.
- [x] New-comment and thread attachments, drop/paste, validated private storage.
- [x] Comment creation/reply/upload retry IDs to avoid repeat submissions.
- [x] Image/video viewer with previous/next and keyboard navigation.
- [x] Per-thread reply/resolution drafts and new-comment draft with saved position.
- [x] Keyboard submission, deep links, site-wide page list and progress.
- [x] Activity endpoint/view, current-page search, site-wide search API.
- [x] PHP feature tests and TypeScript production builds.
- [x] Chrome workflow across two origins; desktop/mobile screenshots and viewport bounds.

## Widget feature parity
- [x] Server-backed unread cursors, current-page unread filter, mark-all-as-read, and anonymous browser read state.
- [x] Site-wide search UI near All pages, pagination, debounce and stale-result guards.
- [x] Alt/Option dragging, new-dot dragging/arrow keys, and click-to-preview/confirm/cancel target reattachment.
- [x] Identity-based comment editing/deletion and reply/file deletion; display names do not grant ownership.
- [x] Six dark themes, persistent sidebar side/size, pause/hide dots, and a Settings gear.
- [x] Previous/next thread navigation and persistent collapse/expand-all.
- [x] Load the latest two replies initially, then older history in 20-reply pages; retain old-client compatibility.
- [x] Per-file retry/removal controls with stable upload IDs after failed or lost responses.
- [x] Activity date grouping.
- [x] Activity unread filtering without marking threads read just by browsing the feed.
- [x] WordPress reference layout: original dot hues/glow, segmented statuses, header chevron, upload sections, sidebar rows/counts/totals.

## Optional migration
- [ ] Importer for existing WordPress feedback.

## Production deployment
- [x] Environment separation and PHP 8.2 compatibility target.
- [x] Stable widget loader and immutable runtime filenames.
- [x] Deployment script with fast-forward Git updates, builds, migrations and health checks.
- [x] Separate releases, persistent private storage, previous-release rollback links.
- [x] Retain older widget/dashboard assets for open browser sessions.
- [ ] Configure Git remote and production branch.
- [ ] Create three ServerPilot apps, dedicated system user, DNS, SSL and database.
- [ ] Set production secrets, backup command, upload limits and permissions.
- [ ] Test actual deployment and rollback on a staging ServerPilot server.
- [ ] Verify physical mobile devices, actual Safari, Drupal and a real client-rendered site before launch.
- [x] Complete Chromium/Firefox/WebKit visual-reference regression run: 18 browser workflows passed.

## Private email accounts

- [x] Email magic links, display names, account sessions and sign-out.
- [x] Owner/Member per-site membership and all-feedback access enforcement.
- [x] Pending/Accepted invitations with copy, resend, delete, and member removal.
- [x] Popup/code widget handoff without third-party cookies.
- [x] Authenticated private media; old public guest/signed routes retired.
- [x] Owner feedback reset and stale-draft invalidation.
- [x] Optional interactive nuke.sh to start the entire standalone installation fresh.
- [x] Local additive migration; no automatic legacy-data deletion.
- [ ] Configure/verify production email sender and provider.
- [ ] Deploy account release and claim live site ownership.
- [ ] Explicitly reset legacy production feedback and invite actual members.
