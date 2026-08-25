#!/usr/bin/env node
/**
 * Run all tests/*.test.ts with Node's built-in test runner.
 * Use this for local development; CI runs `npm test`.
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(repoRoot, "tests");
const testFiles = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join("tests", name).replace(/\\/g, "/"));

if (testFiles.length === 0) {
  console.error("run-tests: no tests/*.test.ts files found");
  process.exit(1);
}

const watch = process.argv.includes("--watch");
const cmd = [
  "node",
  "--experimental-strip-types",
  "--test",
  ...(watch ? ["--watch"] : []),
  ...testFiles,
].join(" ");

execSync(cmd, { stdio: "inherit", cwd: repoRoot });
