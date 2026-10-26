# Changelog

## Streamlined theme selection

Commit message: Streamline theme choices and repair retained theme styles

- Reduce the combined appearance list to 11 themes: Graphite, Carbon, Emerald, Neon, Linen, Windows 3.11, Windows XP, Macintosh, Mac OS 9, Game Boy, and C64.
- Migrate retired theme selections and legacy aliases to retained alternatives.
- Start Windows 3.11 on a fresh row, leaving the space beside Linen empty.
- Restore Mac OS 9 and Windows XP styles and preview colors; use a CSS parser for safe theme removal.
- Extend preference migration tests and browser checks for every retained preview gradient.

## Sidebar polish and theme collection

Commit message: Polish sidebar navigation and add classic theme collection

- Add 22 ordered themes, including modern dark palettes and classic product-inspired designs; preserve renamed theme selections and complete the two-column grid.
- Unify sidebar SVG icons, button dimensions, hover/selected treatments, and left-aligned view titles; move Comments and Activity beside Settings.
- Remember sidebar open/closed choices per site across reloads and navigation; expand status groups when enabling the Unread filter.
- Replace comment unread labels with a blue dot beside the author.
- Link URLs in comments, replies, and resolution notes while preserving query parameters.
- Increase reply fields to a 116px minimum and replace reply trash emoji with an X and edit-style hover background.
- Extend browser coverage for sidebar persistence, unread expansion, URL linking, theme switching, and consistent header geometry.

## 0.2.0 — Standalone widget parity

Commit message: Port review workflows and refine standalone widget UI
- Allow expanded reply history to collapse back to the latest two replies and reopen without downloading it again.
- Use relative times for replies and activity, with clearer activity headings, previews, and reference card spacing.
- Space earlier-reply controls and match WordPress reply headers with a hover trash icon beside the author.
- Preserve new-comment draft attachments in browser storage across closing and reloading, and remove the attachment deletion confirmation.
- Simplified the name prompt, spaced its Continue action, and restored flat white-bordered dots without a glow.
- Put attachment removal X controls over thumbnails, align theme swatch/label columns, and separate resolution draft/actions with consistent spacing.
- Match the WordPress sidebar, composer and thread hierarchy, typography, component widths, count badges, site totals and attachment sections.
- Restore the original saturated Open/Review/Content/Closed dot hues with flat white borders and an outer pulse; keep readable status-text colors separate.
- Port all six dark palettes, a Settings gear beside Close, persistent sidebar position/size and pause/hide-dot controls.
- Add previous/next review navigation, collapse/expand-all, per-page group persistence and the Control sidebar shortcut.
- Add guest-scoped server read cursors, unread filters and mark-all-as-read; exclude contributors' own activity and retain concurrent arrivals.
- Add ownership-checked editing/deletion, click-to-confirm reattachment, dot dragging and draft-dot keyboard movement.
- Page older replies and retain failed thread uploads for retry with stable IDs; preserve response behavior for older widget builds.
- Keep drafts and collapsed groups separate for meaningful query-string pages; retain draft discard controls.
- Separate API, guest-session, owner and upload rate-limit counters so browsing cannot exhaust the name-entry limit.
- Batch comment-author and page-count queries, with regression coverage for 50 comments.
- Expand browser tests to Chromium, Firefox and WebKit, including visual-reference screenshots and hostile host-font isolation.

## 0.1.0 — Standalone foundation

Commit message: Create standalone FlakFlak foundation with API, dashboard, and widget
- Introduce an independent Laravel 12/PHP 8.2 API, Vue dashboard and embedded widget.
- Add name-only guest sessions, per-site data, comments, replies, statuses and files.
- Add local demos, automated tests, environment templates and ServerPilot deployment tooling.
- Preserve the WordPress plugin unchanged; record remaining feature parity in CHECKLIST.md.
