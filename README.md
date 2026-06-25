# pi-mdxml-context

Pi extension that converts Markdown context into XML-like structure at model send time, while keeping the original Markdown in the session history.

It is meant for agent workflows where Markdown files are convenient for humans, but explicit XML-like boundaries can make complex context easier for models to parse.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the maintenance direction (stabilization, performance/token efficiency, design boundaries, template compliance, and public-release quality) and the candidate maintenance seeds.

## Features

- Converts Markdown context files before model requests
- Converts Markdown tool results without mutating saved session history
- Preserves source metadata on the generated XML root element
- Supports frontmatter, GFM, code blocks, tables, wikilinks, and Obsidian-style callouts
- Provides preview and A/B toggle commands
- Skips conversion when XML output grows too large

## How it works

The extension uses Pi runtime hooks:

- `before_agent_start` converts loaded Markdown context files.
- `tool_result` tracks recently-read Markdown content.
- `context` converts Markdown tool results only in the provider-bound context.

The session still stores the original Markdown. Conversion happens only for the model request.

## Install

Clone or copy this project into a Pi extension location, for example:

```text
.pi/extensions/pi-mdxml-context/
```

Then install dependencies:

```sh
npm install
```

Reload Pi:

```text
/reload
```

Pi loads the extension from `package.json` via:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

## Commands

| Command | Description |
| --- | --- |
| `/mdxml:on` | Enable send-time conversion. |
| `/mdxml:off` | Disable send-time conversion. |
| `/mdxml:status` | Show conversion state and recent stats. |
| `/mdxml:preview path/to/file.md` | Preview XML-like output for a Markdown file. |
| `/mdxml:preview recent:1` | Preview XML-like output for the most recent Markdown tool result. |

Preview arguments support completion for Markdown paths and `recent:N` targets.

## Output shape

Example root element:

```xml
<markdown_context source="tool_result" path="docs/example.md" tool="read" original_format="markdown" converted_by="pi-mdxml-context">
  <section depth="1" title="Example">
    <paragraph>Hello <strong>world</strong>.</paragraph>
  </section>
</markdown_context>
```

The output is strict-ish XML: a single root, escaped text, escaped attributes, and fixed tag names. Schema validation is intentionally out of scope for the first version.

## Safety notes

- Conversion is enabled by default after the extension loads.
- `/mdxml:off` disables conversion immediately.
- The extension does not rewrite saved session messages.
- Large conversions are skipped when output exceeds the configured expansion guard.

## Development

```sh
npm install
npm run check
```

## Release

Publishing is automated through GitHub Actions:

1. Merge a version bump in `package.json` to `main`.
2. **Auto Release** validates the package, creates the semver tag, and opens a GitHub release.
3. Auto Release dispatches **Publish to npm** (`publish.yml`) for that tag.
4. Publish uses npm OIDC trusted publishing (`id-token: write`); no `NPM_TOKEN` secret is required.

### Verify tag to npm publish

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

## License

MIT
