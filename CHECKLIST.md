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

## Existing-plugin parity still to implement
- [ ] Server-backed unread state and unread-only controls.
- [x] Site-wide search UI near All pages, pagination, debounce and stale-result guards.
- [ ] Dot movement and explicit target reattachment.
- [ ] Ownership-based edit/delete actions.
- [ ] Theme selection, sidebar side/size, pause/hide dot settings.
- [ ] Previous/next thread navigation and collapse/expand-all.
- [ ] Paginated reply loading for large threads.
- [ ] Attachment failure/retry UX for each thread upload.
- [x] Activity date grouping.
- [ ] Activity unread filtering.
- [ ] Optional importer for existing WordPress feedback.

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
- [ ] Test Safari, Firefox, mobile devices, Drupal and a client-rendered site.

## Later
- [ ] Account registration/sign-in and secure guest-to-account linking.
- [ ] Site memberships, invitations, roles and per-action permissions.
