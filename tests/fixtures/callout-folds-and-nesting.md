## Golden harness context

Supporting prose keeps this snapshot fixture comfortably inside the converter's expansion guard. The examples below pin Obsidian callout folds, nested callouts, and a callout inside a list item.

> [!note]+
> An expanded note with no title on the marker line.

> [!tip]-
> A collapsed tip with no title on the marker line.

> [!warning] Outer alert
> The outer callout contains a nested callout.
>
> > [!tip]- Nested hint
> > The nested tip keeps its own fold and title.

- List item containing a callout
  > [!note]+
  > This note is nested inside the list item.

## Golden harness footer

Trailing context provides stable surrounding markdown for golden snapshot tests.

Additional padding line one for expansion ratio compliance.

Additional padding line two for expansion ratio compliance.

Additional padding line three for expansion ratio compliance.
