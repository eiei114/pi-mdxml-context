import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

describe("convertMarkdown golden fixtures", () => {
  for (const name of readdirSync(fixturesDir)) {
    if (!name.endsWith(".md")) continue;
    const base = name.replace(/\.md$/, "");
    it(`matches committed golden XML for ${base}`, () => {
      const md = readFileSync(join(fixturesDir, name), "utf8");
      const expected = readFileSync(join(fixturesDir, `${base}.expected.xml`), "utf8").replace(/\r\n/g, "\n");
      const result = convertMarkdown(md, goldenProvenance);
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
      if (result.ok) {
        assert.equal(result.xml, expected);
      }
    });
  }
});

describe("provenance attributes on markdown_context root", () => {
  const sampleMd = readFileSync(join(fixturesDir, "wikilink.md"), "utf8");

  it("emits context_file source and path", () => {
    const result = convertMarkdown(sampleMd, {
      source: "context_file",
      path: "notes/foo.md",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(
        result.xml,
        /^<markdown_context source="context_file" path="notes\/foo.md" original_format="markdown" converted_by="pi-mdxml-context">/,
      );
    }
  });

  it("emits tool_result source, path, and tool", () => {
    const result = convertMarkdown(sampleMd, {
      source: "tool_result",
      path: "tools/grep.txt",
      tool: "grep",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(
        result.xml,
        /^<markdown_context source="tool_result" path="tools\/grep.txt" tool="grep" original_format="markdown" converted_by="pi-mdxml-context">/,
      );
    }
  });

  it("emits preview source and path without tool", () => {
    const result = convertMarkdown(sampleMd, {
      source: "preview",
      path: "preview/sample.md",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(
        result.xml,
        /^<markdown_context source="preview" path="preview\/sample.md" original_format="markdown" converted_by="pi-mdxml-context">/,
      );
      assert.doesNotMatch(result.xml, /\btool="/);
    }
  });
});

describe("expansion guard", () => {
  it("rejects conversion when expansion ratio exceeds the limit", () => {
    const result = convertMarkdown("# Hi", goldenProvenance);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.skipCategory, "expansion_ratio");
      assert.match(result.reason, /expansion ratio exceeds 2/);
      assert.equal(result.originalChars, 4);
      assert.ok(result.outputChars !== undefined && result.outputChars > 4);
    }
  });
});
