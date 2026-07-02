# Contributing to pi-mdxml-context

Thank you for your interest in contributing to `pi-mdxml-context`!

This document covers the practical guidelines for contributing to this repository.

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to contribute

### Reporting bugs

- Check if the bug has already been reported in [Issues](https://github.com/eiei114/pi-mdxml-context/issues).
- Open a new issue with a clear title, steps to reproduce, expected vs. actual behavior, and environment details (Node.js version, OS, Pi version).
- Include sample Markdown input and expected XML output when relevant.

### Suggesting features

- Open a feature request issue describing the problem or use case.
- Propose a design and explain how it aligns with the project's guiding principles (see [ROADMAP.md](ROADMAP.md)).

### Submitting changes

1. Fork the repository or create a feature branch from `main`.
2. Run `npm install` to install dependencies.
3. Make your changes, keeping them focused and atomic.
4. Run `npm run check` (TypeScript type check) and `npm test` (all tests) — both must pass.
5. If you changed any source file that affects the published package, bump the version in `package.json` and add a changelog entry in `CHANGELOG.md`.
6. Open a pull request against `main`.

## Pull request guidelines

- Keep PRs small and focused on one concern. A PR that fixes a bug and adds a feature is harder to review than two separate PRs.
- Reference the related issue number in the PR description.
- Write a clear, descriptive PR title and summary.
- For publishable changes (source files, docs, tests): bump `package.json` and update `CHANGELOG.md` in the same PR. The CI job `version:check` verifies this.
- No behavioral change to core conversion logic without explicit issue + test coverage.

## Development setup

```bash
git clone https://github.com/eiei114/pi-mdxml-context.git
cd pi-mdxml-context
npm install
npm run check   # TypeScript type check
npm test        # Run all tests
```

## Project structure

| Path | Purpose |
| --- | --- |
| `index.ts` | Single-file Pi extension entrypoint |
| `tests/` | Test suites (converter golden, expansion guard, runtime hooks, preview store) |
| `tests/fixtures/` | Markdown fixtures and expected XML outputs |
| `docs/` | Usage and release documentation |
| `scripts/` | Build and release helper scripts |
| `ROADMAP.md` | Phased project goals and compliance checklist |

## Testing

- Write tests for new functionality or bug fixes.
- Golden test fixtures go in `tests/fixtures/` as matched `.md` / `.expected.xml` pairs.
- Run tests with `npm test`. Use `node --experimental-strip-types --test --watch tests/` during development.
- Ensure existing golden tests produce byte-identical output after your changes.

## Release workflow

See [`docs/release.md`](docs/release.md) for the npm Trusted Publishing workflow.

## Questions

Open a [discussion](https://github.com/eiei114/pi-mdxml-context/discussions) or an issue with a question tag.
