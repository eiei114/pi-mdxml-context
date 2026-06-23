import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import piMdxmlContext, { MAX_COMPLETIONS, MAX_RECENT, normalizePreviewArg } from "../index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const markdownFixture = readFileSync(join(__dirname, "fixtures", "wikilink.md"), "utf8");

type HandlerMap = {
  tool_result?: (event: ToolResultEvent) => void | Promise<void>;
};

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

function loadExtensionHarness(): {
  handlers: HandlerMap;
  commands: Map<string, RegisteredCommand>;
} {
  const handlers: HandlerMap = {};
  const commands = new Map<string, RegisteredCommand>();
  const pi = {
    on(event: keyof HandlerMap, handler: HandlerMap[keyof HandlerMap]) {
      handlers[event] = handler as never;
    },
    registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      commands.set(name, {
        name,
        sourceInfo: { path: "test", source: "test", scope: "user", origin: "package" },
        ...options,
      });
    },
  } as ExtensionAPI;

  piMdxmlContext(pi);
  return { handlers, commands };
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
  it("returns recent items first and caps total results", async () => {
    const { handlers, commands } = loadExtensionHarness();
    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    for (let index = 0; index < 5; index += 1) {
      await handlers.tool_result?.(
        readToolResultEvent(
          `call-auto-${index}`,
          `${markdownFixture}\n<!-- auto-${index} -->`,
          `docs/auto-${index}.md`,
        ),
      );
    }

    const completions = (await preview.getArgumentCompletions?.("")) ?? [];
    assert.ok(completions.length <= MAX_COMPLETIONS);
    assert.ok(completions.slice(0, 5).every((item) => item.value.startsWith("recent:")));
    assert.equal(completions[0]?.value, "recent:1");
  });
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
