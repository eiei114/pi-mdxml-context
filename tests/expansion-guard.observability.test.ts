import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { convertMarkdown } from "../index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

const goldenProvenance = {
  source: "context_file" as const,
  path: "tests/fixtures/sample.md",
};

describe("expansion guard observability", () => {
  it("reports expansion_ratio skip category with size stats", () => {
    const result = convertMarkdown("# Hi", goldenProvenance);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.skipCategory, "expansion_ratio");
      assert.match(result.reason, /expansion ratio exceeds 2/);
      assert.equal(result.originalChars, 4);
      assert.ok(result.outputChars !== undefined && result.outputChars > 4);
      assert.ok(result.expansionRatio !== undefined && result.expansionRatio > 2);
    }
  });

  it("reports max_output_chars skip category with size stats", () => {
    const markdown = "x".repeat(60_000);
    const result = convertMarkdown(markdown, goldenProvenance);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.skipCategory, "max_output_chars");
      assert.match(result.reason, /output exceeds 50000 chars/);
      assert.equal(result.originalChars, 60_000);
      assert.ok(result.outputChars !== undefined && result.outputChars > 50_000);
      assert.ok(result.expansionRatio !== undefined && result.expansionRatio > 1);
    }
  });

  it("includes expansion ratio on successful conversion", () => {
    const markdown = readFileSync(join(fixturesDir, "wikilink.md"), "utf8");
    const result = convertMarkdown(markdown, goldenProvenance);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.originalChars > 0);
      assert.ok(result.outputChars > result.originalChars);
      assert.equal(result.expansionRatio, result.outputChars / result.originalChars);
    }
  });

  it("treats short Markdown fixed overhead as expansion_ratio skip", () => {
    const result = convertMarkdown("## A", goldenProvenance);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.skipCategory, "expansion_ratio");
      assert.equal(result.originalChars, 4);
      assert.ok(result.outputChars !== undefined);
      assert.ok(result.expansionRatio !== undefined && result.expansionRatio > 2);
    }
  });
});
