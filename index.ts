import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type ExtensionAPI = any;
type ExtensionContext = any;
type ExtensionCommandContext = any;
type AutocompleteItem = { value: string; label: string; description?: string };

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

type ConversionResult =
  | { ok: true; xml: string; originalChars: number; outputChars: number }
  | { ok: false; reason: string; originalChars: number; outputChars?: number };

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
const MAX_COMPLETIONS = 40;
const MAX_OUTPUT_CHARS = 50_000;
const MAX_EXPANSION_RATIO = 2.0;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

let enabled = true;
let cwd = process.cwd();
let lastStats = { converted: 0, skipped: 0 };
let activeStats = { converted: 0, skipped: 0 };
let recentSeq = 0;
const recent: RecentItem[] = [];
const toolMetaByCallId = new Map<string, ToolMeta>();

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string | undefined): string {
  return escapeText(value ?? "").replace(/"/g, "&quot;").replace(/\r?\n/g, " ");
}

function attrs(values: Record<string, string | number | boolean | undefined>): string {
  const rendered = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`);
  return rendered.length > 0 ? ` ${rendered.join(" ")}` : "";
}

function collectText(node: MdNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(collectText).join("");
}

function isMarkdownPath(path: unknown): path is string {
  return typeof path === "string" && /\.md(?:x)?$/i.test(path.replace(/^@/, ""));
}

function looksLikeMarkdown(content: string): boolean {
  const sample = content.slice(0, 4000);
  if (/^---\r?\n[\s\S]*?\r?\n---/m.test(sample)) return true;
  if (/\[\[[^\]]+\]\]/.test(sample)) return true;
  if (/^>\s*\[![^\]]+\]/m.test(sample)) return true;
  return false;
}

function shouldConvert(content: string, path?: string): boolean {
  if (path && isMarkdownPath(path)) return true;
  return looksLikeMarkdown(content);
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const textParts = content
    .filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "text")
    .map((part) => (part as { text?: string }).text ?? "");
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

function replaceTextContent(content: unknown, text: string): unknown {
  if (typeof content === "string") return text;
  if (!Array.isArray(content)) return content;
  let replaced = false;
  const next = content.map((part) => {
    if (!part || typeof part !== "object" || (part as { type?: string }).type !== "text") return part;
    if (replaced) return { ...(part as object), text: "" };
    replaced = true;
    return { ...(part as object), text };
  });
  return replaced ? next : [{ type: "text", text }];
}

function preprocessObsidianMarkdown(markdown: string): string {
  return markdown.replace(/^>\s*\[!([^\]]+)]([+-])?\s*(.*)$/gm, (_match, type, fold, title) => {
    const foldPart = fold ? ` fold=${fold}` : "";
    const titlePart = title ? ` title=${title}` : "";
    return `> [!${String(type).trim()}${foldPart}${titlePart}]`;
  });
}

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

function renderInlines(children: MdNode[] | undefined): string {
  return (children ?? []).map(renderInline).join("");
}

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
    if (xml.length > MAX_OUTPUT_CHARS) {
      return { ok: false, reason: `output exceeds ${MAX_OUTPUT_CHARS} chars`, originalChars, outputChars: xml.length };
    }
    if (xml.length > originalChars * MAX_EXPANSION_RATIO) {
      return { ok: false, reason: `expansion ratio exceeds ${MAX_EXPANSION_RATIO}`, originalChars, outputChars: xml.length };
    }
    return { ok: true, xml, originalChars, outputChars: xml.length };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), originalChars };
  }
}

function addRecent(content: string, provenance: Provenance): void {
  const label = provenance.path ?? `${provenance.tool ?? provenance.source}:${recentSeq + 1}`;
  recent.unshift({ id: ++recentSeq, label, content, provenance });
  recent.splice(MAX_RECENT);
}

function updateStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("mdxml", `mdxml:${enabled ? "on" : "off"} ${lastStats.converted}c/${lastStats.skipped}s`);
}

function beginStats(): void {
  activeStats = { converted: 0, skipped: 0 };
}

function endStats(ctx: ExtensionContext): void {
  lastStats = { ...activeStats };
  updateStatus(ctx);
}

function getInputPath(input: Record<string, unknown>): string | undefined {
  const raw = input.path;
  return typeof raw === "string" ? raw.replace(/^@/, "") : undefined;
}

function resolvePreviewPath(arg: string): string {
  const clean = arg.replace(/^@/, "");
  return resolve(cwd, clean);
}

function findMarkdownFiles(prefix: string): AutocompleteItem[] {
  const normalizedPrefix = prefix.replace(/^@/, "").replace(/\\/g, "/");
  const results: AutocompleteItem[] = [];
  const ignored = new Set([".git", ".obsidian", "node_modules", ".pi", ".claude"]);

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

function previewCompletions(prefix: string): AutocompleteItem[] {
  const recentItems = recent.map((item, index) => ({
    value: `recent:${index + 1}`,
    label: `recent:${index + 1}`,
    description: item.label,
  }));
  return [...recentItems, ...findMarkdownFiles(prefix)].slice(0, MAX_COMPLETIONS);
}

async function handlePreview(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const target = args.trim();
  if (!target) {
    ctx.ui.notify("Usage: /mdxml:preview <path.md|recent:N>", "warning");
    return;
  }

  let content: string;
  let provenance: Provenance;
  const recentMatch = target.match(/^recent:(\d+)$/i);
  if (recentMatch) {
    const item = recent[Number(recentMatch[1]) - 1];
    if (!item) {
      ctx.ui.notify(`No recent Markdown item: ${target}`, "error");
      return;
    }
    content = item.content;
    provenance = { ...item.provenance, source: "preview" };
  } else {
    const fullPath = resolvePreviewPath(target);
    content = await readFile(fullPath, "utf8");
    provenance = { source: "preview", path: relative(cwd, fullPath).split(sep).join("/") };
  }

  const result = convertMarkdown(content, provenance);
  const preview = result.ok
    ? result.xml
    : `<mdxml_skipped reason="${escapeAttr(result.reason)}" original_chars="${result.originalChars}" output_chars="${result.outputChars ?? ""}" />`;
  const edited = await ctx.ui.editor("mdxml preview", preview);
  if (edited === undefined) ctx.ui.notify("Preview closed", "info");
}

export { convertMarkdown };
export type { ConversionResult, Provenance };

export default function piMdxmlContext(pi: ExtensionAPI): void {
  pi.on("session_start", (_event: any, ctx: ExtensionContext) => {
    cwd = ctx.cwd;
    updateStatus(ctx);
  });

  pi.on("before_agent_start", (event: any, ctx: ExtensionContext) => {
    beginStats();
    if (!enabled) return;
    let systemPrompt = event.systemPrompt;
    for (const contextFile of event.systemPromptOptions.contextFiles ?? []) {
      if (!isMarkdownPath(contextFile.path)) continue;
      const result = convertMarkdown(contextFile.content, { source: "context_file", path: contextFile.path });
      if (!result.ok) {
        activeStats.skipped += 1;
        continue;
      }
      if (!systemPrompt.includes(contextFile.content)) {
        activeStats.skipped += 1;
        continue;
      }
      systemPrompt = systemPrompt.split(contextFile.content).join(result.xml);
      activeStats.converted += 1;
    }
    updateStatus(ctx);
    return { systemPrompt };
  });

  pi.on("tool_result", (event: any) => {
    const content = extractTextContent(event.content);
    if (!content) return;
    const path = getInputPath(event.input);
    if (!shouldConvert(content, path)) return;
    const provenance: Provenance = { source: "tool_result", path, tool: event.toolName };
    toolMetaByCallId.set(event.toolCallId, { content, provenance });
    addRecent(content, provenance);
  });

  pi.on("context", (event: any, ctx: ExtensionContext) => {
    if (!enabled) {
      endStats(ctx);
      return;
    }
    const messages = event.messages.map((message: any) => {
      if (message?.role !== "toolResult") return message;
      const content = extractTextContent(message.content);
      if (!content) return message;
      const meta = toolMetaByCallId.get(message.toolCallId);
      const path = meta?.provenance.path;
      if (!meta && !shouldConvert(content, path)) return message;
      const result = convertMarkdown(content, meta?.provenance ?? { source: "tool_result", path, tool: message.toolName });
      if (!result.ok) {
        activeStats.skipped += 1;
        return message;
      }
      activeStats.converted += 1;
      return { ...message, content: replaceTextContent(message.content, result.xml) };
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
      ctx.ui.notify("mdxml conversion enabled", "info");
    },
  });

  pi.registerCommand("mdxml:off", {
    description: "Disable Markdown-to-XML send-time conversion",
    getArgumentCompletions: () => [],
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      enabled = false;
      updateStatus(ctx);
      ctx.ui.notify("mdxml conversion disabled", "info");
    },
  });

  pi.registerCommand("mdxml:status", {
    description: "Show Markdown-to-XML conversion status",
    getArgumentCompletions: () => [],
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      updateStatus(ctx);
      ctx.ui.notify(
        `mdxml:${enabled ? "on" : "off"}; last converted=${lastStats.converted}; skipped=${lastStats.skipped}; recent=${recent.length}`,
        "info",
      );
    },
  });

  pi.registerCommand("mdxml:preview", {
    description: "Preview Markdown-to-XML conversion for a Markdown file or recent:N",
    getArgumentCompletions: (prefix: string) => previewCompletions(prefix),
    handler: handlePreview,
  });
}
