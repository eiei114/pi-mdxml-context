import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import piMdxmlContext from "../index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const markdownFixture = readFileSync(join(__dirname, "fixtures", "wikilink.md"), "utf8");

type HandlerMap = {
  before_agent_start?: (
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext,
  ) => BeforeAgentStartEventResult | void | Promise<BeforeAgentStartEventResult | void>;
  context?: (
    event: ContextEvent,
    ctx: ExtensionContext,
  ) => { messages?: AgentMessage[] } | void | Promise<{ messages?: AgentMessage[] } | void>;
  tool_result?: (event: ToolResultEvent) => void | Promise<void>;
};

function createMockContext(hasUI = false): ExtensionContext {
  return {
    hasUI,
    cwd: process.cwd(),
    ui: {
      notify() {},
      setStatus() {},
      editor: async () => undefined,
    },
  } as unknown as ExtensionContext;
}

function createMockCommandContext(hasUI = false): ExtensionCommandContext {
  return createMockContext(hasUI) as ExtensionCommandContext;
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

function readToolResultEvent(text: string): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "call-read",
    toolName: "read",
    input: { path: "docs/example.md" },
    content: [{ type: "text", text }],
    isError: false,
    details: undefined,
  } as ToolResultEvent;
}

describe("runtime hook safety", () => {
  it("before_agent_start survives missing systemPromptOptions", async () => {
    const { handlers } = loadExtensionHarness();
    const event = {
      type: "before_agent_start",
      prompt: "hi",
      systemPrompt: markdownFixture,
      systemPromptOptions: undefined,
    } as unknown as BeforeAgentStartEvent;

    const result = await handlers.before_agent_start?.(event, createMockContext());
    assert.deepEqual(result, { systemPrompt: markdownFixture });
  });

  it("before_agent_start survives missing contextFiles", async () => {
    const { handlers } = loadExtensionHarness();
    const event = {
      type: "before_agent_start",
      prompt: "hi",
      systemPrompt: markdownFixture,
      systemPromptOptions: { cwd: process.cwd() },
    } as BeforeAgentStartEvent;

    const result = await handlers.before_agent_start?.(event, createMockContext());
    assert.deepEqual(result, { systemPrompt: markdownFixture });
  });

  it("before_agent_start converts markdown context files when present", async () => {
    const { handlers } = loadExtensionHarness();
    const event: BeforeAgentStartEvent = {
      type: "before_agent_start",
      prompt: "hi",
      systemPrompt: markdownFixture,
      systemPromptOptions: {
        cwd: process.cwd(),
        contextFiles: [{ path: "docs/example.md", content: markdownFixture }],
      },
    };

    const result = await handlers.before_agent_start?.(event, createMockContext());
    assert.ok(result?.systemPrompt);
    assert.notEqual(result?.systemPrompt, markdownFixture);
    assert.match(result?.systemPrompt ?? "", /<markdown_context/);
  });

  it("tool_result ignores image-only content without throwing", async () => {
    const { handlers } = loadExtensionHarness();
    const event = {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "docs/example.md" },
      content: [{ type: "image", data: "abc", mimeType: "image/png" }],
      isError: false,
      details: undefined,
    } as ToolResultEvent;

    const toolResult = handlers.tool_result;
    assert.ok(toolResult);
    await assert.doesNotReject(async () => toolResult(event));
  });

  it("context leaves image-only tool results unchanged", async () => {
    const { handlers } = loadExtensionHarness();
    const imageOnly: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call-2",
      toolName: "read",
      content: [{ type: "image", data: "abc", mimeType: "image/png" }],
      isError: false,
      timestamp: 1,
    };
    const event: ContextEvent = {
      type: "context",
      messages: [imageOnly],
    };

    const result = await handlers.context?.(event, createMockContext());
    assert.equal(result?.messages?.[0], imageOnly);
  });

  it("context converts tracked markdown tool results for provider-bound messages", async () => {
    const { handlers } = loadExtensionHarness();
    await handlers.tool_result?.(readToolResultEvent(markdownFixture));

    const toolMessage: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call-read",
      toolName: "read",
      content: [{ type: "text", text: markdownFixture }],
      isError: false,
      timestamp: 2,
    };
    const result = await handlers.context?.(
      { type: "context", messages: [toolMessage] },
      createMockContext(),
    );
    const converted = result?.messages?.[0] as ToolResultMessage;
    assert.equal(converted.role, "toolResult");
    assert.match(converted.content[0]?.type === "text" ? converted.content[0].text : "", /<markdown_context/);
  });

  it("preview command does not touch UI when hasUI is false", async () => {
    const { commands } = loadExtensionHarness();
    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    let editorCalls = 0;
    const ctx = createMockCommandContext(false);
    ctx.ui.editor = async () => {
      editorCalls += 1;
      return undefined;
    };

    await preview.handler("missing.md", ctx);
    assert.equal(editorCalls, 0);
  });

  it("preview command reports read errors when UI exists", async () => {
    const { commands } = loadExtensionHarness();
    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    const notifications: Array<{ message: string; type?: string }> = [];
    const ctx = createMockCommandContext(true);
    ctx.ui.notify = (message, type) => {
      notifications.push({ message, type });
    };
    ctx.ui.editor = async () => undefined;

    const missingPath = `__missing-${randomUUID()}.md`;
    await preview.handler(missingPath, ctx);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.type, "error");
    assert.match(notifications[0]?.message ?? "", /Failed to read/);
  });

  it("preview command reports editor failures when UI exists", async () => {
    const { handlers, commands } = loadExtensionHarness();
    await handlers.tool_result?.(readToolResultEvent(markdownFixture));

    const preview = commands.get("mdxml:preview");
    assert.ok(preview);

    const notifications: Array<{ message: string; type?: string }> = [];
    const ctx = createMockCommandContext(true);
    ctx.ui.notify = (message, type) => {
      notifications.push({ message, type });
    };
    ctx.ui.editor = async () => {
      throw new Error("editor unavailable");
    };

    await preview.handler("recent:1", ctx);
    assert.ok(notifications.some((entry) => entry.type === "error" && /editor failed/i.test(entry.message)));
  });
});

describe("workflow action versions", () => {
  const workflowsDir = join(__dirname, "..", ".github", "workflows");

  for (const file of readdirSync(workflowsDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    it(`${file} pins checkout and setup-node to v6 when used`, () => {
      const content = readFileSync(join(workflowsDir, file), "utf8");
      if (content.includes("actions/checkout@")) {
        assert.match(content, /actions\/checkout@v6\b/);
        assert.doesNotMatch(content, /actions\/checkout@v[0-5]\b/);
      }
      if (content.includes("actions/setup-node@")) {
        assert.match(content, /actions\/setup-node@v6\b/);
        assert.doesNotMatch(content, /actions\/setup-node@v[0-5]\b/);
      }
    });
  }
});
