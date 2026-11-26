## Aligned GFM table

The delimiter row assigns a different alignment to each column: left for the item, center for the status, and right for the count. Alignment is a presentation hint in the Markdown source. The XML keeps the header and the data in source order without carrying those hints into the output.

| Item     | Status  | Count |
| :------- | :-----: | ----: |
| Notebook | Ready   |    12 |
| Pencil   | Pending |     3 |

This inventory excerpt distinguishes items that are ready to distribute from items that are still pending. The notebook and pencil entries use different statuses and quantities so that each data cell and row can be identified after conversion. This surrounding prose also keeps the sample below the expansion guard so the golden test can compare the XML rather than a skipped conversion.
