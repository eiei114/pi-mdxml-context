#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  parseJsonLines,
  SDK_NAMES,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = process.argv.includes("--update-curated-report")
  ? resolve(root, "docs/verification/pi-sdk-smoke.json")
  : resolve(root, ".tmp/pi-sdk-smoke.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) =>
  [name, readJson(resolve(root, "node_modules", name, "package.json")).version]));
for (const name of SDK_NAMES) {
  if (manifest.devDependencies?.[name] !== sdkVersions[name]) {
    throw new Error(`Smoke requires the exact dev/test SDK pin for ${name}: installed ${sdkVersions[name]}`);
  }
}
const piManifest = readJson(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"));
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", piManifest.bin.pi);
const agentDir = mkdtempSync(resolve(tmpdir(), "pi-mdxml-sdk-smoke-"));
writeFileSync(resolve(agentDir, "wikilink.md"), readFileSync(resolve(root, "tests/fixtures/wikilink.md"), "utf8"));
const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
const rpcArgs = [piCli, "--offline", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
  "--no-context-files", "--no-prompt-templates", "--no-mcp", "-e", root, "--mode", "rpc"];
const TIMEOUT_MS = 15_000;
const command = "npm run smoke:pi";

function capturedRpcEvidence(records) {
  const relevant = records.flatMap((record) => {
    if (record.type === "extension_ui_request") {
      if (record.method === "editor") {
        return [{ type: record.type, method: record.method, title: record.title, prefill: record.prefill }];
      }
      if (record.method === "notify") {
        const message = String(record.message ?? "").replaceAll(root, "<checkout>").replaceAll(agentDir, "<isolated-agent-dir>");
        return [{ type: record.type, method: record.method, notifyType: record.notifyType, message }];
      }
      if (record.method === "setStatus") {
        return [{ type: record.type, method: record.method, statusKey: record.statusKey, statusText: record.statusText }];
      }
    }
    if (record.type === "response" && record.command === "get_commands") {
      const commands = (record.data?.commands ?? []).map(({ name, source }) => ({ name, source }));
      return [{ type: record.type, command: record.command, success: record.success, data: { commands } }];
    }
    if (record.type === "response" && record.command === "prompt") {
      return [{ type: record.type, command: record.command, success: record.success, data: record.data, error: record.error }];
    }
    return [];
  });
  return relevant.map((record) => JSON.stringify(record)).join("\n");
}

function runRpcCase(name, promptMessage) {
  return new Promise((resolveCase) => {
    const child = spawn(process.execPath, rpcArgs, { cwd: agentDir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let buffer = "";
    let timedOut = false;
    let processExitObserved = false;
    let spawnError;
    let registeredCommands = [];
    let promptResponse;
    let editorRequest;
    const notifications = [];
    const records = [];
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    // The Pi host can exit between the writable check and the write, which emits
    // EPIPE on child.stdin. Without a listener that becomes an unhandled error and
    // the case never settles, so surface it through the same failure path.
    const stdinErrors = [];
    child.stdin.on("error", (error) => {
      stdinErrors.push(error?.message ?? String(error));
      child.kill("SIGKILL");
    });
    const send = (request) => {
      if (child.stdin.destroyed || child.stdin.writableEnded) return;
      try {
        child.stdin.write(`${JSON.stringify(request)}
`);
      } catch (error) {
        stdinErrors.push(error?.message ?? String(error));
        child.kill("SIGKILL");
      }
    };
    const endInput = () => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    };

    child.on("spawn", () => send({ id: "commands", type: "get_commands" }));
    child.on("error", (error) => { spawnError = error; });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        records.push(record);
        if (record.type === "extension_ui_request" && record.method === "editor") {
          editorRequest = record;
          send({ type: "extension_ui_response", id: record.id, value: record.prefill ?? "" });
        }
        if (record.type === "extension_ui_request" && record.method === "notify") notifications.push(record);
        if (record.type === "response" && record.id === "commands") {
          registeredCommands = record.success === true ? record.data?.commands ?? [] : [];
          if (name === "extension_load") endInput();
          else send({ id: "prompt", type: "prompt", message: promptMessage });
        }
        if (record.type === "response" && record.id === "prompt") {
          promptResponse = record;
          endInput();
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status, signal) => {
      processExitObserved = true;
      clearTimeout(timer);
      const fullOutput = `${stdout}${stderr}`;
      const exit_code = status ?? 1;
      const assertions = behaviorAssertions(name, {
        registeredCommands,
        promptResponse,
        editorRequest,
        notifications,
        exit_code,
        fullOutput,
        processExitObserved,
        pathRoots: [root, agentDir],
      });
      const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(fullOutput);
      const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput);
      resolveCase({
        name,
        command,
        exit_code,
        passed: !timedOut && !spawnError && !signal && exit_code === 0 && stdinErrors.length === 0
          && !hasUnhandledError && !hasLoadError && assertions.every((item) => item.passed),
        stdin_error: stdinErrors[0] ?? null,
        evidence: capturedRpcEvidence(records) || (spawnError ? String(spawnError.message) : "No relevant RPC output captured"),
        assertions,
        hasUnhandledError,
        hasLoadError,
        timedOut,
        process_exit_observed: processExitObserved,
      });
    });
  });
}

function runHostShellCase(expectedVersion) {
  let executable;
  let args;
  if (process.platform === "win32") {
    executable = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    args = ["-NoProfile", "-NonInteractive", "-Command",
      `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`];
  } else {
    executable = "/bin/sh";
    args = ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli];
  }
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 1_048_576,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exit_code = result.status ?? 1;
  const assertions = behaviorAssertions("host_shell", { exit_code, fullOutput: result.stdout ?? "", expectedVersion });
  const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(output);
  const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(output);
  return {
    name: "host_shell",
    command,
    exit_code,
    passed: !result.error && exit_code === 0 && !hasUnhandledError && !hasLoadError
      && assertions.every((item) => item.passed),
    evidence: output || String(result.error?.message ?? "No output captured"),
    assertions,
    hasUnhandledError,
    hasLoadError,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

try {
  const cases = [
    await runRpcCase("extension_load"),
    await runRpcCase("happy_path", "/mdxml:preview wikilink.md"),
    await runRpcCase("error_path", "/mdxml:preview __pi-mdxml-smoke-missing__.md"),
    await runRpcCase("reload_cleanup", "/mdxml:preview wikilink.md"),
    runHostShellCase(sdkVersions["@earendil-works/pi-coding-agent"]),
  ];
  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; actual Pi RPC process executes mdxml:preview against a repository Markdown fixture",
    unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
    extension_load_errors: cases.filter((item) => item.hasLoadError
      || (item.name === "extension_load" && !item.passed)).length,
    cases: cases.map(({ hasUnhandledError, hasLoadError, timedOut, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    cases: cases.map(({ name, passed, exit_code, timedOut }) => ({ name, passed, exit_code, timedOut })),
  }));
  if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
