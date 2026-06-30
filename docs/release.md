# Release

This package uses npm Trusted Publishing with GitHub Actions OIDC.

Do not add `NPM_TOKEN` or long-lived npm tokens to GitHub Secrets.

## One-time npm setup

On npmjs.com, configure Trusted Publishing for this package:

- Publisher: GitHub Actions
- Repository: `eiei114/pi-mdxml-context`
- Workflow filename: `publish.yml`

## Publish flow

1. Merge a version bump in `package.json` to `main`.
2. **Auto Release** (`auto-release.yml`) validates the package, creates the semver tag, and opens a GitHub release.
3. Auto Release dispatches **Publish to npm** (`publish.yml`) for that tag.
4. Publish uses npm OIDC trusted publishing (`id-token: write`); no `NPM_TOKEN` secret is required.

```bash
npm version patch
git push
```

## Verify tag to npm publish

After a release tag is created:

```sh
# Confirm Auto Release dispatched publish for the tag
gh run list --workflow publish.yml --limit 5

# Inspect the publish run for the tag
gh run view <run-id> --log

# Confirm the package version is on npm
npm view pi-mdxml-context@<version> version
```

For a manual publish check, dispatch publish from the tag:

```sh
gh workflow run publish.yml --ref v<version> -f ref=v<version>
```

## Workflow guardrail

Do not ship a new version bump with only `package.json` changes. Update `CHANGELOG.md` in the same PR. CI runs `npm run version:check` on pull requests when publishable files change.

The repository uses this release workflow pair:

- `.github/workflows/auto-release.yml` creates `v<version>` tags and GitHub Releases from `main` version bumps.
- `.github/workflows/publish.yml` publishes to npm through Trusted Publishing.

Important: tags or releases created by `GITHUB_TOKEN` do not reliably fan out into another workflow through normal `push.tags` or `release.published` triggers. `auto-release.yml` explicitly dispatches `publish.yml` after creating the tag/release.

## GitHub Actions requirements

- `permissions: id-token: write` on publish
- `permissions: actions: write` on auto-release so it can dispatch `publish.yml`
- GitHub-hosted runner
- Node.js 24
- No `NPM_TOKEN`
