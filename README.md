# pi-mdxml-context

[![CI](https://github.com/eiei114/pi-mdxml-context/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-mdxml-context/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-mdxml-context/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-mdxml-context/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-mdxml-context.svg)](https://www.npmjs.com/package/pi-mdxml-context)
[![npm downloads](https://img.shields.io/npm/dm/pi-mdxml-context.svg)](https://www.npmjs.com/package/pi-mdxml-context)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)

> Convert Markdown context to XML-like structure at model send time while keeping the original Markdown in session history.

## What this is

`pi-mdxml-context` is a Pi extension for agent workflows where Markdown is convenient for humans, but explicit XML-like boundaries can make complex context easier for models to parse.

It converts loaded Markdown context files and recent Markdown tool results before each model request. Saved session history stays in Markdown; conversion happens only in the provider-bound context.

## Features

- Converts Markdown context files before model requests.
- Converts Markdown tool results without mutating saved session history.
- Preserves source metadata on the generated XML root element.
- Supports frontmatter, GFM, code blocks, tables, wikilinks, and Obsidian-style callouts.
- Provides preview and on/off toggle commands.
- Skips conversion when XML output grows too large.

## Install

Install the published npm package with Pi:

```bash
pi install npm:pi-mdxml-context
```

Pin a specific version when you want reproducible installs:

```bash
pi install npm:pi-mdxml-context@0.1.9
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:pi-mdxml-context -l
```

Or install from GitHub:

```bash
pi install git:github.com/eiei114/pi-mdxml-context
```

Try it without permanently installing:

```bash
pi -e npm:pi-mdxml-context
```

## Quick start

After install, reload Pi if needed:

```text
/reload
```

Check that conversion is active:

```text
/mdxml:status
```

Preview XML-like output for a Markdown file:

```text
/mdxml:preview path/to/file.md
```

For commands, output shape, runtime hooks, and safety behavior, see [`docs/usage.md`](docs/usage.md).

## Usage summary

| Command | Description |
| --- | --- |
| `/mdxml:on` | Enable send-time conversion. |
| `/mdxml:off` | Disable send-time conversion. |
| `/mdxml:status` | Show conversion state and recent stats. |
| `/mdxml:preview <path>` | Preview XML-like output for a Markdown file. |
| `/mdxml:preview recent:N` | Preview XML-like output for a recent Markdown tool result. |

Conversion is enabled by default after the extension loads. Use `/mdxml:off` to disable it immediately.

## Package contents

| Path | Purpose |
| --- | --- |
| `index.ts` | Pi TypeScript extension entrypoint |
| `tests/` | Converter, runtime hook, and preview tests |
| `docs/` | Usage and release docs (`usage.md`, `release.md`) |
| `README.md` | Public entrypoint (this file) |
| `CHANGELOG.md` | Version history |
| `SECURITY.md` | Vulnerability reporting |
| `LICENSE` | MIT license |

## Development

```bash
npm install
npm run check
npm test
```

Before opening a PR with publishable changes, bump `package.json` and update `CHANGELOG.md` in the same PR. CI runs `npm run version:check` on pull requests.

## Release

This package uses npm Trusted Publishing with GitHub Actions OIDC — no `NPM_TOKEN` is required.

On `main`, a version bump in `package.json` triggers **Auto Release**, which creates the semver tag and GitHub Release, then dispatches **Publish to npm** (`publish.yml`).

See [`docs/release.md`](docs/release.md) for setup details and tag-to-npm verification steps. See [`CHANGELOG.md`](CHANGELOG.md) for semver history.

## Security

Pi packages run with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-mdxml-context
- GitHub: https://github.com/eiei114/pi-mdxml-context
- Issues: https://github.com/eiei114/pi-mdxml-context/issues
- Roadmap: [ROADMAP.md](ROADMAP.md)

## License

MIT
