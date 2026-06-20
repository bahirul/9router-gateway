# Release Notes

## v0.2.0 — 2026-06-20

Changes since `v0.1.2`.

This release expands 9Router Smart Router from a routing gateway into a more complete operations console with dashboard-managed configuration, API-key controls, decision review workflows, learned routing, privacy cleanup tools, and stronger deployment defaults.

### Breaking Changes

- Decision review now uses the new individual decision review workflow and stores review feedback in SQLite-backed decision history.
- Decision corrections no longer mutate global routing config automatically. Learned routing examples are created only when explicitly enabled during manual or model review.

### Highlights

- Added SQLite-backed runtime config so dashboard edits persist safely across restarts.
- Added configurable task classes, dashboard task-class management, and reset-to-default built-in English task classes.
- Added API-key quotas and forced-model restrictions for client keys.
- Added individual and batch decision review with optional judge-model evaluation.
- Added learned routing examples for similar future prompts, replacing older prompt-correction behavior while keeping compatibility metadata.
- Added prompt privacy controls for reviewed decisions and all stored decision prompt/request context.
- Added overview task duration by summing recorded latency.
- Added proxy-aware real client IP extraction for Cloudflare and forwarded-header deployments.

### Routing and Classification

- Task classes can be configured from YAML on first import and then managed in the dashboard.
- Built-in task-class defaults are now English-only and exposed through the config API.
- Dashboard task-class edits are validated and persisted in SQLite.
- Learned routing can override the normal routing target when a stored example is sufficiently similar and confident.
- Learned routing training is opt-in for manual review and batch/model review.
- Router behavior now better separates forced model requests, shadow mode, affinity, task classification, and learned routing.

### Dashboard and Operations

- Added a dedicated Task Classifier page.
- Added dashboard modals, improved empty chart states, mobile form fixes, and select/dropdown styling refinements.
- Added client example configuration UI with copy actions.
- Added database reset controls while preserving protected bootstrap data.
- Added System actions to reset learned routing data and clear prompt data without deleting decision history.
- Renamed decision status language toward optional review, using unreviewed/reviewed semantics instead of implying review is required.
- Added cursor-pointer behavior for clickable dashboard elements.

### Decision Review

- Added model-assisted review for individual decisions.
- Added batch review of filtered unreviewed decisions.
- Added model-review confidence handling, robust judge JSON parsing, and fallback behavior when upstream response formatting is unsupported.
- Reviews always store feedback; learned routing examples are created only when the operator enables training.
- Manual feedback can optionally create a learned routing example for similar future prompts.

### Security and Client Keys

- Added client API-key request quotas.
- Added forced-model restrictions per API key.
- Ensured client `Authorization` and `x-api-key` headers are replaced/stripped before forwarding upstream, with upstream auth controlled by gateway config.
- Improved admin/session and CSRF-covered review/config endpoints through tests and docs.

### Deployment and Runtime

- Updated Docker runtime to use a glibc-compatible base for classifier support.
- Fixed upstream compatibility GitHub Action configuration.
- Added proxy-aware client IP detection with priority for `CF-Connecting-IP`, `True-Client-IP`, `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, then socket IP.
- Improved upstream smoke testing and model validation behavior.

### Documentation

- Refreshed README and operations, routing, configuration, development, and clients docs.
- Documented learned routing similarity, opt-in review training, prompt-data retention controls, task-classifier defaults, API-key handling, and reverse-proxy IP behavior.

### Fixes and Cleanup

- Fixed first-render chart dimensions and improved empty chart placeholders.
- Fixed dashboard form overflow on mobile.
- Fixed decision database indexing behavior.
- Hardened model judge response parsing.
- Cleaned decision-store feedback/review code paths for readability and reduced duplication.

### Notable Commits

- `7abaefd` — `feat(decisions)!: review individual decisions`
- `1fdf14d` — `feat(config): store dashboard config in SQLite`
- `fab23ec` — `feat(api-keys): add request quotas`
- `e4e72d3` — `feat: task classifier via dashboard`
- `d1c156a` — `feat: correction feedback using model`
- `5c4d001` — `feat(ui): add batch decision review`
- `15a438b` — `feat(admin): propose routing config updates`
- `dd85056` — `feat: learned-routing refactor`
- `d473868` — `feat(review): make learned routing opt-in`
- `3cd457f` — `feat(admin): add prompt data cleanup`
- `229c0b8` — `fix: Added shared IP helper with header priority`
- `7212096` — `feat: clean up and docs updates`

## v0.1.2 — 2026-06-15

Changes since `v0.1.1`.

### Added

- Added package version display in the System dashboard.

### Release

- Tagged `v0.1.2` as a patch release after the package version display update.

### Notable Commits

- `7fef90f` — `feat(system): show package version`
- `c691b9f` — `release: v0.1.2`

## v0.1.1 — 2026-06-15

Initial tagged release.

### Added

- Added the 9Router Smart Router gateway foundation.
- Added dashboard session handling with redirect to login when sessions expire.
- Added the scoped global gateway binary for CLI installation and startup.
- Added range-aware overview charts for dashboard analytics.
- Added README screenshots and feature documentation.

### Changed

- Made the dashboard always enabled through config cleanup.
- Removed legacy release cruft from configuration.
- Updated package metadata and versioning for release.

### Documentation

- Documented dashboard features and environment knobs in the README.
- Added and refreshed dashboard screenshots.

### Notable Commits

- `981cbe1` — `first commit`
- `016981e` — `feat(ui): redirect expired sessions to login`
- `bdd9bfb` — `feat(cli): add scoped global gateway binary`
- `4b08fbd` — `feat(dashboard): add range-aware overview charts`
- `d74fee9` — `docs(readme): document features and env knobs`
- `f341fd9` — `release: v0.1.1`
