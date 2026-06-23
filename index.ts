import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent, ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionStartEvent,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type ToolContent = string | ReadonlyArray<TextContent | ImageContent>;

type MdNode = {
  type: string;
  value?: string;
  lang?: string;
  url?: string;
  title?: string;
  depth?: number;
  ordered?: boolean;
  checked?: boolean | null;
  align?: Array<string | null>;
  children?: MdNode[];
  [key: string]: unknown;
};

type Provenance = {
  source: "context_file" | "tool_result" | "preview";
  path?: string;
  tool?: string;
};

type SkipCategory = "max_output_chars" | "expansion_ratio" | "error";

type ConversionResult =
  | { ok: true; xml: string; originalChars: number; outputChars: number; expansionRatio: number }
  | {
      ok: false;
      reason: string;
      skipCategory: SkipCategory;
      originalChars: number;
      outputChars?: number;
      expansionRatio?: number;
    };

type GuardEvent = {
  id: number;
  label: string;
  outcome: "converted" | "skipped";
  skipCategory?: SkipCategory;
  originalChars: number;
  outputChars?: number;
  expansionRatio?: number;
  provenance: Provenance;
};

type RecentItem = {
  id: number;
  label: string;
  content: string;
  provenance: Provenance;
};

type ToolMeta = {
  content: string;
  provenance: Provenance;
};

const EXTENSION_NAME = "pi-mdxml-context";
const MAX_RECENT = 20;
const MAX_GUARD_EVENTS = 10;
const MAX_COMPLETIONS = 40;
const MAX_TOOL_META = 50;
const MAX_OUTPUT_CHARS = 50_000;
const MAX_EXPANSION_RATIO = 2.0;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

let enabled = true;
let cwd = process.cwd();
let lastStats = { converted: 0, skipped: 0 };
let activeStats = { converted: 0, skipped: 0 };
let recentSeq = 0;
let guardEventSeq = 0;
const recent: RecentItem[] = [];
const guardEvents: GuardEvent[] = [];
const toolMetaByCallId = new Map<string, ToolMeta>();

/** Compute output/original character ratio for guard diagnostics. */
function expansionRatio(originalChars: number, outputChars: number): number {
  if (originalChars === 0) return outputChars === 0 ? 1 : Infinity;
  return outputChars / originalChars;
}

/** Escape XML special characters in text content. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape and flatten a value for use in XML attributes. */
function escapeAttr(value: string | undefined): string {
  return escapeText(value ?? "").replace(/"/g, "&quot;").replace(/\r?\n/g, " ");
}

/** Render optional XML attributes from a key-value map. */
function attrs(values: Record<string, string | number | boolean | undefined>): string {
  const rendered = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`);
  return rendered.length > 0 ? ` ${rendered.join(" ")}` : "";
}

/** Recursively collect plain text from a markdown AST node. */
function collectText(node: MdNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(collectText).join("");
}

/** Return true when the path looks like a Markdown file. */
function isMarkdownPath(path: unknown): path is string {
  return typeof path === "string" && /\.md(?:x)?$/i.test(path.replace(/^@/, ""));
}

/** Heuristically detect Markdown-like content from a sample prefix. */
function looksLikeMarkdown(content: string): boolean {
  const sample = content.slice(0, 4000);
  if (/^---\r?\n[\s\S]*?\r?\n---/m.test(sample)) return true;
  if (/\[\[[^\]]+\]\]/.test(sample)) return true;
  if (/^>\s*\[![^\]]+\]/m.test(sample)) return true;
  return false;
}

/** Decide whether content should be converted based on path or content shape. */
function shouldConvert(content: string, path?: string): boolean {
  if (path && isMarkdownPath(path)) return true;
  return looksLikeMarkdown(content);
}

/** Extract plain text from Pi tool result content shapes. */
function extractTextContent(content: ToolContent | unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const textParts = content
    .filter((part): part is TextContent => part?.type === "text")
    .map((part) => part.text ?? "");
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

/** Replace text parts in Pi tool result content while preserving structure. */
function replaceTextContent(content: ToolContent | unknown, text: string): ToolContent | unknown {
  if (typeof content === "string") return text;
  if (!Array.isArray(content)) return content;
  let replaced = false;
  const next = content.map((part) => {
    if (part?.type !== "text") return part;
    if (replaced) return { ...part, text: "" };
    replaced = true;
    return { ...part, text };
  });
  return replaced ? next : [{ type: "text", text }];
}

/** Narrow agent messages to tool results for send-time conversion. */
function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

/** Notify the user only when interactive UI is available. */
function notifyUI(
  ctx: ExtensionContext | ExtensionCommandContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (!ctx.hasUI) return;
  ctx.ui.notify(message, type);
}

/** Read context files from optional system prompt options without throwing. */
function getContextFiles(
  options: BeforeAgentStartEvent["systemPromptOptions"] | undefined,
): ReadonlyArray<{ path: string; content: string }> {
  return options?.contextFiles ?? [];
}

/** Normalize Obsidian callout blockquote syntax before parsing. */
function preprocessObsidianMarkdown(markdown: string): string {
  return markdown.replace(/^>\s*\[!([^\]]+)]([+-])?\s*(.*)$/gm, (_match, type, fold, title) => {
    const foldPart = fold ? ` fold=${fold}` : "";
    const titlePart = title ? ` title=${title}` : "";
    return `> [!${String(type).trim()}${foldPart}${titlePart}]`;
  });
}

/** Render wikilink and embed patterns inside inline text. */
function renderInlineText(value: string): string {
  const pattern = /(!)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let output = "";
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    output += escapeText(value.slice(lastIndex, match.index));
    const isEmbed = match[1] === "!";
    const target = match[2]?.trim() ?? "";
    const alias = match[3]?.trim();
    output += isEmbed
      ? `<embed${attrs({ target })} />`
      : `<wikilink${attrs({ target, alias })} />`;
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  output += escapeText(value.slice(lastIndex));
  return output;
}

/** Render a single inline markdown node to XML. */
function renderInline(node: MdNode): string {
  switch (node.type) {
    case "text":
      return renderInlineText(node.value ?? "");
    case "inlineCode":
      return `<code>${escapeText(node.value ?? "")}</code>`;
    case "strong":
      return `<strong>${renderInlines(node.children)}</strong>`;
    case "emphasis":
      return `<emphasis>${renderInlines(node.children)}</emphasis>`;
    case "delete":
      return `<delete>${renderInlines(node.children)}</delete>`;
    case "link":
      return `<link${attrs({ href: node.url, title: node.title })}>${renderInlines(node.children)}</link>`;
    case "image":
      return `<image${attrs({ src: node.url, title: node.title, alt: node.alt as string | undefined })} />`;
    case "break":
      return "<line_break />";
    case "html":
      return `<html_inline>${escapeText(node.value ?? "")}</html_inline>`;
    default:
      if (node.children) return renderInlines(node.children);
      return node.value ? escapeText(node.value) : "";
  }
}

/** Render a list of inline markdown nodes to XML. */
function renderInlines(children: MdNode[] | undefined): string {
  return (children ?? []).map(renderInline).join("");
}

/** Parse an Obsidian callout from a blockquote node when present. */
function parseCallout(node: MdNode): { type: string; fold?: string; title?: string; children: MdNode[] } | undefined {
  const children = node.children ?? [];
  const first = children[0];
  const firstChild = first?.children?.[0];
  if (first?.type !== "paragraph" || firstChild?.type !== "text") return undefined;
  const value = firstChild.value ?? "";
  const match = value.match(/^\[!([^\] \t]+)(?:\s+fold=([^\] \t]+))?(?:\s+title=(.*))?\]\s*/);
  if (!match) return undefined;

  const rest = value.slice(match[0].length);
  const nextFirst: MdNode = {
    ...first,
    children: rest ? [{ ...firstChild, value: rest }, ...(first.children ?? []).slice(1)] : (first.children ?? []).slice(1),
  };
  const nextChildren = nextFirst.children && nextFirst.children.length > 0 ? [nextFirst, ...children.slice(1)] : children.slice(1);
  return { type: match[1] ?? "note", fold: match[2], title: match[3], children: nextChildren };
}

/** Render a block-level markdown node to XML. */
function renderBlock(node: MdNode, indexInParent = -1): string {
  switch (node.type) {
    case "yaml":
      return `<frontmatter format="yaml">${escapeText(node.value ?? "")}</frontmatter>`;
    case "paragraph":
      return `<paragraph>${renderInlines(node.children)}</paragraph>`;
    case "list":
      return `<list${attrs({ ordered: Boolean(node.ordered) })}>${(node.children ?? []).map(renderBlock).join("")}</list>`;
    case "listItem":
      return `<list_item${attrs({ checked: typeof node.checked === "boolean" ? node.checked : undefined })}>${(node.children ?? []).map(renderBlock).join("")}</list_item>`;
    case "blockquote": {
      const callout = parseCallout(node);
      if (callout) {
        return `<callout${attrs({ type: callout.type, fold: callout.fold, title: callout.title })}>${callout.children.map(renderBlock).join("")}</callout>`;
      }
      return `<blockquote>${(node.children ?? []).map(renderBlock).join("")}</blockquote>`;
    }
    case "code":
      return `<code_block${attrs({ language: node.lang })}>${escapeText(node.value ?? "")}</code_block>`;
    case "table":
      return `<table>${(node.children ?? []).map((child, index) => renderBlock(child, index)).join("")}</table>`;
    case "tableRow":
      return `<table_row${attrs({ header: indexInParent === 0 ? true : undefined })}>${(node.children ?? []).map(renderBlock).join("")}</table_row>`;
    case "tableCell":
      return `<table_cell>${(node.children ?? []).map(renderInline).join("")}</table_cell>`;
    case "thematicBreak":
      return "<thematic_break />";
    case "html":
      return `<html_block>${escapeText(node.value ?? "")}</html_block>`;
    case "definition":
      return `<definition${attrs({ identifier: node.identifier as string | undefined, url: node.url, title: node.title })} />`;
    case "section":
      return `<section${attrs({ depth: node.depth, title: node.title as string | undefined })}>${(node.children ?? []).map(renderBlock).join("")}</section>`;
    case "heading":
      return `<heading${attrs({ depth: node.depth })}>${renderInlines(node.children)}</heading>`;
    default:
      if (node.children) return `<node${attrs({ type: node.type })}>${node.children.map(renderBlock).join("")}</node>`;
      return node.value ? `<node${attrs({ type: node.type })}>${escapeText(node.value)}</node>` : `<node${attrs({ type: node.type })} />`;
  }
}

/** Group top-level nodes into nested sections by heading depth. */
function sectionize(children: MdNode[]): MdNode[] {
  const root: MdNode = { type: "section", depth: 0, title: "", children: [] };
  const stack: MdNode[] = [root];

  for (const child of children) {
    if (child.type !== "heading") {
      stack[stack.length - 1].children?.push(child);
      continue;
    }
    const depth = child.depth ?? 1;
    while (stack.length > 1 && (stack[stack.length - 1].depth ?? 0) >= depth) stack.pop();
    const section: MdNode = { type: "section", depth, title: collectText(child).trim(), children: [] };
    stack[stack.length - 1].children?.push(section);
    stack.push(section);
  }

  return root.children ?? [];
}

/** Convert markdown source to XML with provenance metadata and size guards. */
function convertMarkdown(markdown: string, provenance: Provenance): ConversionResult {
  const originalChars = markdown.length;
  try {
    const tree = processor.parse(preprocessObsidianMarkdown(markdown)) as MdNode;
    const body = sectionize(tree.children ?? []).map(renderBlock).join("\n");
    const xml = `<markdown_context${attrs({
      source: provenance.source,
      path: provenance.path,
      tool: provenance.tool,
      original_format: "markdown",
      converted_by: EXTENSION_NAME,
    })}>\n${body}\n</markdown_context>`;
    const outputChars = xml.length;
    const ratio = expansionRatio(originalChars, outputChars);
    if (outputChars > MAX_OUTPUT_CHARS) {
      return {
        ok: false,
        reason: `output exceeds ${MAX_OUTPUT_CHARS} chars`,
        skipCategory: "max_output_chars",
        originalChars,
        outputChars,
        expansionRatio: ratio,
      };
    }
    if (ratio > MAX_EXPANSION_RATIO) {
      return {
        ok: false,
        reason: `expansion ratio exceeds ${MAX_EXPANSION_RATIO}`,
        skipCategory: "expansion_ratio",
        originalChars,
        outputChars,
        expansionRatio: ratio,
      };
    }
    return { ok: true, xml, originalChars, outputChars, expansionRatio: ratio };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      skipCategory: "error",
      originalChars,
    };
  }
}

/** Record a recent Expansion Guard decision for status diagnostics. */
function recordGuardEvent(result: ConversionResult, provenance: Provenance, label: string): void {
  if (result.ok) {
    guardEvents.unshift({
      id: ++guardEventSeq,
      label,
      outcome: "converted",
      originalChars: result.originalChars,
      outputChars: result.outputChars,
      expansionRatio: result.expansionRatio,
      provenance,
    });
  } else {
    guardEvents.unshift({
      id: ++guardEventSeq,
      label,
      outcome: "skipped",
      skipCategory: result.skipCategory,
      originalChars: result.originalChars,
      outputChars: result.outputChars,
      expansionRatio: result.expansionRatio,
      provenance,
    });
  }
  guardEvents.splice(MAX_GUARD_EVENTS);
}

/** Format one guard event for concise status output. */
function formatGuardEvent(event: GuardEvent): string {
  const size = `${event.originalChars}→${event.outputChars !== undefined ? event.outputChars : "?"}`;
  const ratioPart =
    event.expansionRatio !== undefined ? ` (${event.expansionRatio.toFixed(1)}x)` : "";
  if (event.outcome === "converted") return `converted ${size}${ratioPart} ${event.label}`;
  return `${event.skipCategory} ${size}${ratioPart} ${event.label}`;
}

/** Build the /mdxml:status notification message. */
function formatStatusMessage(): string {
  const parts = [
    `mdxml:${enabled ? "on" : "off"}`,
    `last converted=${lastStats.converted}`,
    `skipped=${lastStats.skipped}`,
    `recent=${recent.length}`,
  ];
  const recentGuard = guardEvents.slice(0, 3).map(formatGuardEvent);
  if (recentGuard.length > 0) parts.push(`guard: ${recentGuard.join("; ")}`);
  return parts.join("; ");
}

/** Store a recently converted markdown payload for preview completions. */
function addRecent(content: string, provenance: Provenance): void {
  const label = provenance.path ?? `${provenance.tool ?? provenance.source}:${recentSeq + 1}`;
  recent.unshift({ id: ++recentSeq, label, content, provenance });
  recent.splice(MAX_RECENT);
}

/** Refresh the extension status line in the UI when available. */
function updateStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("mdxml", `mdxml:${enabled ? "on" : "off"} ${lastStats.converted}c/${lastStats.skipped}s`);
}

/** Reset per-turn conversion counters before agent work. */
function beginStats(): void {
  activeStats = { converted: 0, skipped: 0 };
}

/** Commit per-turn stats and refresh status after agent work. */
function endStats(ctx: ExtensionContext): void {
  lastStats = { ...activeStats };
  updateStatus(ctx);
}

/** Normalize preview paths and autocomplete prefixes for cwd-relative resolution. */
function normalizePreviewArg(arg: string): string {
  return arg.trim().replace(/^@/, "").replace(/\\/g, "/").replace(/\/\/+/g, "/");
}

/** Read an optional path field from tool input with preview path normalization. */
function getInputPath(input: Record<string, unknown>): string | undefined {
  const raw = input.path;
  return typeof raw === "string" ? normalizePreviewArg(raw) : undefined;
}

/** Resolve a preview command argument to an absolute path under cwd. */
function resolvePreviewPath(arg: string, baseCwd = cwd): string {
  return resolve(baseCwd, normalizePreviewArg(arg));
}

/** Store tool metadata for send-time replacement with bounded retention. */
function storeToolMeta(toolCallId: string, meta: ToolMeta): void {
  toolMetaByCallId.set(toolCallId, meta);
  while (toolMetaByCallId.size > MAX_TOOL_META) {
    const oldest = toolMetaByCallId.keys().next().value;
    if (oldest === undefined) break;
    toolMetaByCallId.delete(oldest);
  }
}

/** Drop tool metadata after send-time replacement or eviction. */
function purgeToolMeta(toolCallId: string): void {
  toolMetaByCallId.delete(toolCallId);
}

/** Collect markdown file paths under cwd for autocomplete, up to a depth limit. */
function findMarkdownFiles(prefix: string): AutocompleteItem[] {
  const normalizedPrefix = normalizePreviewArg(prefix);
  const results: AutocompleteItem[] = [];
  const ignored = new Set([".git", ".obsidian", "node_modules", ".pi", ".claude"]);

  /** Recursively scan directories for markdown files matching the prefix. */
  function walk(dir: string, depth: number): void {
    if (results.length >= MAX_COMPLETIONS || depth > 5) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= MAX_COMPLETIONS) return;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!normalizedPrefix || rel.startsWith(normalizedPrefix) || normalizedPrefix.startsWith(`${rel}/`)) walk(full, depth + 1);
        continue;
      }
      if (extname(entry.name).toLowerCase() !== ".md") continue;
      if (normalizedPrefix && !rel.toLowerCase().includes(normalizedPrefix.toLowerCase())) continue;
      results.push({ value: rel, label: rel, description: "Markdown file" });
    }
  }

  if (existsSync(cwd)) walk(cwd, 0);
  return results;
}

/** Build autocomplete items from recent conversions and workspace markdown files. */
function previewCompletions(prefix: string): AutocompleteItem[] {
  const recentItems = recent.map((item, index) => ({
    value: `recent:${index + 1}`,
    label: `recent:${index + 1}`,
    description: item.label,
  }));
  return [...recentItems, ...findMarkdownFiles(prefix)].slice(0, MAX_COMPLETIONS);
}

/** Run /mdxml:preview for a file path or recent:N and show the result in an editor. */
async function handlePreview(args: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  const target = args.trim();
  if (!target) {
    notifyUI(ctx, "Usage: /mdxml:preview <path.md|recent:N>", "warning");
    return;
  }

  let content: string;
  let provenance: Provenance;
  const recentMatch = target.match(/^recent:(\d+)$/i);
  if (recentMatch) {
    const item = recent[Number(recentMatch[1]) - 1];
    if (!item) {
      notifyUI(ctx, `No recent Markdown item: ${target}`, "error");
      return;
    }
    content = item.content;
    provenance = { ...item.provenance, source: "preview" };
  } else {
    const fullPath = resolvePreviewPath(target, ctx.cwd);
    try {
      content = await readFile(fullPath, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notifyUI(ctx, `Failed to read ${target}: ${reason}`, "error");
      return;
    }
    provenance = { source: "preview", path: relative(ctx.cwd, fullPath).split(sep).join("/") };
  }

  const result = convertMarkdown(content, provenance);
  if (!result.ok) {
    notifyUI(ctx, `Preview skipped: ${result.reason}`, "warning");
  }
  const preview = result.ok
    ? result.xml
    : `<mdxml_skipped${attrs({
        reason: result.reason,
        skip_category: result.skipCategory,
        original_chars: result.originalChars,
        output_chars: result.outputChars,
        expansion_ratio:
          result.expansionRatio !== undefined ? Number(result.expansionRatio.toFixed(2)) : undefined,
      })} />`;
  try {
    const edited = await ctx.ui.editor("mdxml preview", preview);
    if (edited === undefined) notifyUI(ctx, "Preview closed", "info");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    notifyUI(ctx, `Preview editor failed: ${reason}`, "error");
  }
}

export { convertMarkdown, normalizePreviewArg };
export { MAX_COMPLETIONS, MAX_RECENT, MAX_TOOL_META };
export type { ConversionResult, GuardEvent, Provenance, SkipCategory };

/** Register the pi-mdxml-context extension hooks and commands. */
export default function piMdxmlContext(pi: ExtensionAPI): void {
  pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
    cwd = ctx.cwd;
    updateStatus(ctx);
  });

  pi.on(
    "before_agent_start",
    (event: BeforeAgentStartEvent, ctx: ExtensionContext): BeforeAgentStartEventResult | void => {
      beginStats();
      if (!enabled) return;
      let systemPrompt = typeof event.systemPrompt === "string" ? event.systemPrompt : "";
      for (const contextFile of getContextFiles(event.systemPromptOptions)) {
        if (!contextFile?.path || typeof contextFile.content !== "string") continue;
        if (!isMarkdownPath(contextFile.path)) continue;
        const result = convertMarkdown(contextFile.content, { source: "context_file", path: contextFile.path });
        if (!result.ok) {
          activeStats.skipped += 1;
          recordGuardEvent(result, { source: "context_file", path: contextFile.path }, contextFile.path);
          continue;
        }
        if (!systemPrompt.includes(contextFile.content)) {
          activeStats.skipped += 1;
          continue;
        }
        systemPrompt = systemPrompt.split(contextFile.content).join(result.xml);
        activeStats.converted += 1;
        recordGuardEvent(result, { source: "context_file", path: contextFile.path }, contextFile.path);
      }
      updateStatus(ctx);
      return { systemPrompt };
    },
  );

  pi.on("tool_result", (event: ToolResultEvent) => {
    const content = extractTextContent(event.content);
    if (!content) return;
    const path = getInputPath(event.input);
    if (!shouldConvert(content, path)) return;
    const provenance: Provenance = { source: "tool_result", path, tool: event.toolName };
    storeToolMeta(event.toolCallId, { content, provenance });
    addRecent(content, provenance);
  });

  pi.on("context", (event: ContextEvent, ctx: ExtensionContext): { messages?: AgentMessage[] } | void => {
    if (!enabled) {
      endStats(ctx);
      return;
    }
    const messages = event.messages.map((message: AgentMessage) => {
      if (!isToolResultMessage(message)) return message;
      const content = extractTextContent(message.content);
      if (!content) return message;
      const meta = toolMetaByCallId.get(message.toolCallId);
      const path = meta?.provenance.path;
      if (!meta && !shouldConvert(content, path)) return message;
      const result = convertMarkdown(content, meta?.provenance ?? { source: "tool_result", path, tool: message.toolName });
      if (!result.ok) {
        activeStats.skipped += 1;
        const provenance = meta?.provenance ?? { source: "tool_result", path, tool: message.toolName };
        recordGuardEvent(result, provenance, provenance.path ?? provenance.tool ?? message.toolName ?? "tool_result");
        purgeToolMeta(message.toolCallId);
        return message;
      }
      activeStats.converted += 1;
      const provenance = meta?.provenance ?? { source: "tool_result", path, tool: message.toolName };
      recordGuardEvent(result, provenance, provenance.path ?? provenance.tool ?? message.toolName ?? "tool_result");
      purgeToolMeta(message.toolCallId);
      return { ...message, content: replaceTextContent(message.content, result.xml) as ToolResultMessage["content"] };
    });
    endStats(ctx);
    return { messages };
  });

  pi.registerCommand("mdxml:on", {
    description: "Enable Markdown-to-XML send-time conversion",
    getArgumentCompletions: () => [],
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      enabled = true;
      updateStatus(ctx);
      notifyUI(ctx, "mdxml conversion enabled", "info");
    },
  });

  pi.registerCommand("mdxml:off", {
    description: "Disable Markdown-to-XML send-time conversion",
    getArgumentCompletions: () => [],
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      enabled = false;
      updateStatus(ctx);
      notifyUI(ctx, "mdxml conversion disabled", "info");
    },
  });

  pi.registerCommand("mdxml:status", {
    description: "Show Markdown-to-XML conversion status",
    getArgumentCompletions: () => [],
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      updateStatus(ctx);
      notifyUI(ctx, formatStatusMessage(), "info");
    },
  });

  pi.registerCommand("mdxml:preview", {
    description: "Preview Markdown-to-XML conversion for a Markdown file or recent:N",
    getArgumentCompletions: (prefix: string) => previewCompletions(prefix),
    handler: handlePreview,
  });
}
