# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.10] - 2026-07-02

### Added

- Add `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1) for community guidelines.
- Add `CONTRIBUTING.md` with development setup, PR guidelines, and testing instructions.
- Ship `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` in the npm package.

### Changed

- Update README package contents table to list the new community files.

## [0.1.9] - 2026-07-01

### Changed

- Align README with the Pi OSS minimal-docs policy: badges, required entrypoint sections, and links.
- Add `docs/usage.md` for commands, runtime hooks, output shape, and safety notes.
- Add `docs/release.md` for Trusted Publishing and tag-to-npm verification details.

## [0.1.8] - 2026-06-27

### Added

- Add `SECURITY.md` with vulnerability reporting policy.
- Ship `CHANGELOG.md` and `SECURITY.md` in the npm package.

### Changed

- README links to `SECURITY.md` and `CHANGELOG.md`.

## [0.1.7] - 2026-06-26

### Changed

- Auto Release now dispatches `publish.yml` after creating a semver tag (`actions: write`).
- Document tag-to-npm publish verification steps in README.

## [0.1.6] - 2026-06-24

### Changed

- Add `ROADMAP.md` with phased goals, template-compliance checklist, and candidate maintenance seeds.
- Link the README to the roadmap.

## [0.1.5] - 2026-06-23

### Changed

- Bound Recent Store eviction and tool metadata retention for long sessions.
- Centralize preview path normalization for `@path`, Windows separators, and cwd-relative paths.
- Add preview/recent-store tests for eviction ordering, autocomplete bounds, and path normalization.

## [0.1.4] - 2026-06-23

### Changed

- Harden CI and release automation: run tests and `npm pack --dry-run` on PR/main.
- Validate package (typecheck, tests, pack dry-run) before auto-release tagging and npm publish.
- Add `pi-package` keyword for Pi package discoverability.

## [0.1.3] - 2026-06-23

### Changed

- Harden Pi runtime hooks with typed extension events and safer optional-field handling.
- Skip non-text tool results without throwing and guard preview/UI commands in non-interactive modes.
- Add runtime hook safety tests for missing context data and image-only tool results.

## [0.1.2] - 2026-06-05

### Changed

- Patch bump to verify npm publish workflow.

## [0.1.1] - 2026-06-04

### Changed

- Added `version:check` PR guard support: package script + `scripts/check-version-bump.mjs`.
- Added CI verification that publishable changes must bump `package.json` and update `CHANGELOG.md` in the same PR.

## [prior releases]

See git history and GitHub releases for earlier changes.
