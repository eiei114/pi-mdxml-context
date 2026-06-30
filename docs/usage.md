# Usage

This document covers runtime behavior, commands, and output shape for `pi-mdxml-context`.

## How it works

The extension uses Pi runtime hooks:

- `before_agent_start` converts loaded Markdown context files.
- `tool_result` tracks recently-read Markdown content.
- `context` converts Markdown tool results only in the provider-bound context.

The session still stores the original Markdown. Conversion happens only for the model request.

Pi loads the extension from `package.json`:

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
- Large conversions are skipped when output exceeds the configured expansion guard (50,000 output characters or a 2.0x expansion ratio).

## Local development install

Clone or copy this project into a Pi extension location, for example:

```text
.pi/extensions/pi-mdxml-context/
```

Then install dependencies and reload Pi:

```sh
npm install
```

```text
/reload
```
