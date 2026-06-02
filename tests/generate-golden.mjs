import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convertMarkdown } from "../index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

const provenance = { source: "context_file", path: "tests/fixtures/sample.md" };

for (const name of readdirSync(fixturesDir)) {
  if (!name.endsWith(".md")) continue;
  const base = name.replace(/\.md$/, "");
  const md = readFileSync(join(fixturesDir, name), "utf8");
  const result = convertMarkdown(md, provenance);
  if (!result.ok) {
    console.error(`FAIL ${base}: ${result.reason}`);
    process.exit(1);
  }
  writeFileSync(join(fixturesDir, `${base}.expected.xml`), result.xml, "utf8");
  console.log(`wrote ${base}.expected.xml`);
}
