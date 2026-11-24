import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { loadExtensionHarness } from "./helpers/extension-harness.ts";
import { MAX_COMPLETIONS, MAX_RECENT, normalizePreviewArg } from "../index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const markdownFixture = readFileSync(join(__dirname, "fixtures", "wikilink.md"), "utf8");

function createMockCommandContext(cwd: string): ExtensionCommandContext {
  return {
    hasUI: true,
    cwd,
    ui: {
      notify() {},
      setStatus() {},
      editor: async () => undefined,
    },
  } as unknown as ExtensionCommandContext;
}

function readToolResultEvent(toolCallId: string, text: string, path: string): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId,
    toolName: "read",
    input: { path },
    content: [{ type: "text", text }],
    isError: false,
    details: undefined,
  } as ToolResultEvent;
}

describe("preview path normalization", () => {
  it("strips @ prefix and normalizes Windows separators", () => {
    assert.equal(normalizePreviewArg("  @docs\\\\note.md  "), "docs/note.md");
    assert.equal(normalizePreviewArg("src\\readme.md"), "src/readme.md");
  });
});

describe("recent store", () => {
  it("keeps recent:1 as the newest item after eviction", async () => {
    const { handlers, commands } = loadExtensionHarness();
    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    for (let index = 0; index < MAX_RECENT + 3; index += 1) {
      await handlers.tool_result?.(
        readToolResultEvent(
          `call-${index}`,
          `${markdownFixture}\n<!-- marker-${index} -->`,
          `docs/item-${index}.md`,
        ),
      );
    }

    let editorContent = "";
    const ctx = createMockCommandContext(process.cwd());
    ctx.ui.editor = async (_title, content) => {
      editorContent = content ?? "";
      return undefined;
    };

    await preview.handler("recent:1", ctx);
    assert.match(editorContent, /marker-22/);
  });

  it("orders recent:1 before recent:2 for newest-first access", async () => {
    const { handlers, commands } = loadExtensionHarness();
    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    await handlers.tool_result?.(
      readToolResultEvent("call-first", `${markdownFixture}\n<!-- first -->`, "docs/first.md"),
    );
    await handlers.tool_result?.(
      readToolResultEvent("call-second", `${markdownFixture}\n<!-- second -->`, "docs/second.md"),
    );

    const seen: string[] = [];
    const ctx = createMockCommandContext(process.cwd());
    ctx.ui.editor = async (_title, content) => {
      seen.push(content ?? "");
      return undefined;
    };

    await preview.handler("recent:1", ctx);
    await preview.handler("recent:2", ctx);
    assert.match(seen[0] ?? "", /second/);
    assert.match(seen[1] ?? "", /first/);
  });
});

describe("preview autocomplete", () => {
  const { handlers, commands } = loadExtensionHarness();
  const complete = commands.get("mdxml:preview")?.getArgumentCompletions;
  assert.ok(complete);
  const startSession = (cwd: string) => {
    assert.ok(handlers.session_start);
    handlers.session_start({ type: "session_start", reason: "startup" }, createMockCommandContext(cwd));
  };
  let workspace: string | undefined;

  before(async () => {
    workspace = mkdtempSync(join(tmpdir(), "pi-mdxml-completions-"));
    const docs = join(workspace, "docs");
    mkdirSync(docs);
    for (let index = 0; index < MAX_COMPLETIONS; index += 1) {
      writeFileSync(join(docs, `sample-${index.toString().padStart(2, "0")}.md`), markdownFixture);
    }
    writeFileSync(join(docs, "sample.txt"), "Not Markdown");
    writeFileSync(join(docs, "other.md"), markdownFixture);
    const guides = join(docs, "Guides");
    mkdirSync(guides);
    writeFileSync(join(guides, "GettingStarted.md"), markdownFixture);
    startSession(workspace);

    for (let index = 0; index < MAX_RECENT; index += 1) {
      await handlers.tool_result?.(
        readToolResultEvent(
          `call-auto-${index}`,
          `${markdownFixture}\n<!-- auto-${index} -->`,
          `docs/auto-${index}.md`,
        ),
      );
    }
  });

  after(() => {
    startSession(process.cwd());
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  it("returns recent items newest-first for an empty prefix and caps the combined results", async () => {
    const completions = (await complete("")) ?? [];
    assert.equal(completions.length, MAX_COMPLETIONS);
    assert.deepEqual(
      completions.slice(0, MAX_RECENT).map(({ value, description }) => [value, description]),
      Array.from({ length: MAX_RECENT }, (_, index) => [`recent:${index + 1}`, `docs/auto-${MAX_RECENT - index - 1}.md`]),
    );
    assert.equal(completions[MAX_RECENT]?.description, "Markdown file");
  });

  it("returns only matching recent selectors without renumbering them", async () => {
    const completions = (await complete("RECENT:2")) ?? [];
    assert.deepEqual(completions.map(({ value }) => value), ["recent:2", "recent:20"]);
  });

  it("fills the limit with matching Markdown paths instead of unrelated recent items", async () => {
    const completions = (await complete("@docs\\sample")) ?? [];
    assert.deepEqual(
      completions.map(({ value }) => value).sort(),
      Array.from({ length: MAX_COMPLETIONS }, (_, index) => `docs/sample-${index.toString().padStart(2, "0")}.md`),
    );
  });

  for (const prefix of ["DoCs/gU", "@dOCS\\gUIDES\\gET"]) {
    it(`completes mixed-case nested prefix ${prefix} without changing the path casing`, async () => {
      const completions = (await complete(prefix)) ?? [];
      assert.deepEqual(completions.map(({ value }) => value), ["docs/Guides/GettingStarted.md"]);
    });
  }
});

describe("preview file paths", () => {
  it("reads cwd-relative paths with @ prefix and Windows separators", async () => {
    const { commands } = loadExtensionHarness();
    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    const workspace = mkdtempSync(join(tmpdir(), "pi-mdxml-preview-"));
    const nestedDir = join(workspace, "docs");
    mkdirSync(nestedDir, { recursive: true });
    const filePath = join(nestedDir, "sample.md");
    writeFileSync(filePath, `${markdownFixture}\n# preview sample\n`, "utf8");

    let editorContent = "";
    const ctx = createMockCommandContext(workspace);
    ctx.ui.editor = async (_title, content) => {
      editorContent = content ?? "";
      return undefined;
    };

    await preview.handler("@docs\\sample.md", ctx);
    assert.match(editorContent, /preview sample/);
  });
});
