# pi-mdxml-context

Pi extension that converts Markdown context into XML-like structure before model requests, while keeping original Markdown in the session.

## Features

- Send-time Markdown to XML-like conversion
- Context file conversion
- Markdown tool result conversion without mutating session history
- Preview command for files and recent Markdown tool results
- A/B toggle commands
- Expansion guard for large outputs

## Install

Copy this folder to a Pi extension location:

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

## Commands

```text
/mdxml:on
/mdxml:off
/mdxml:status
/mdxml:preview path/to/file.md
/mdxml:preview recent:1
```

## Development

```sh
npm install
npm run check
```

## License

MIT
