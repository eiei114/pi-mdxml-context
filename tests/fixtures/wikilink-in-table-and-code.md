## Golden harness context

Supporting prose keeps this fixture within the converter's expansion guard while pinning wikilinks in GFM tables, inline code, fenced code, and link text.

| Note | Destination |
| --- | --- |
| [[Project Notes\|the project]] | [[Project Notes#Architecture]] |

Inline code remains literal: `[[Literal Inline]]`.

```md
[[Literal Fenced]] and ![[literal.png]]
```

Wikilink within Markdown link text: [open [[Project Notes|the project]]](https://example.test "External").

## Golden harness footer

Trailing context provides stable surrounding markdown for golden snapshot tests.

Additional padding line one for expansion ratio compliance.

Additional padding line two for expansion ratio compliance.

Additional padding line three for expansion ratio compliance.
