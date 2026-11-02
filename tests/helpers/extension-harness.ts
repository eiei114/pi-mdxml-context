import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  RegisteredCommand,
  SessionStartEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import piMdxmlContext from "../../index.ts";

export type HandlerMap = {
  session_start?: (event: SessionStartEvent, ctx: ExtensionContext) => void;
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

export function loadExtensionHarness(): {
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
