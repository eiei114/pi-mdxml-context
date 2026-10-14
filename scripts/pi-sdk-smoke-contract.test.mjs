import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { behaviorAssertions } from "./pi-sdk-smoke-contract.mjs";

const previewCommand = { name: "mdxml:preview", source: "extension" };
const promptResponse = { success: true, data: { disposition: "handled" } };
const convertedPreview = {
  method: "editor",
  title: "mdxml preview",
  prefill: '<markdown_context source="preview" path="wikilink.md">\n<wikilink target="Target Note" /><wikilink target="Other" alias="display label" />\n</markdown_context>',
};

describe("Pi SDK smoke behavior contract", () => {
  it("accepts the real feature response and rejects a missing preview response", () => {
    const positive = behaviorAssertions("happy_path", {
      promptResponse,
      editorRequest: convertedPreview,
    });
    const missing = behaviorAssertions("happy_path", { promptResponse, editorRequest: null });
    assert.equal(positive[0].id, "feature_response");
    assert.equal(positive[0].passed, true);
    assert.equal(missing[0].passed, false);
  });

  it("requires an observed handled missing-file error, not just a prompt response", () => {
    const notification = { method: "notify", notifyType: "error", message: "Failed to read missing.md: ENOENT" };
    assert.equal(behaviorAssertions("error_path", { promptResponse, notifications: [notification] })[0].passed, true);
    assert.equal(behaviorAssertions("error_path", { promptResponse, notifications: [] })[0].passed, false);
  });

  it("requires a second-process registration, feature response, and clean exit on reload", () => {
    const complete = behaviorAssertions("reload_cleanup", {
      registeredCommands: [previewCommand],
      promptResponse,
      editorRequest: convertedPreview,
      exit_code: 0,
      fullOutput: "",
      processExitObserved: true,
    });
    const noReloadResponse = behaviorAssertions("reload_cleanup", {
      registeredCommands: [previewCommand],
      promptResponse,
      editorRequest: null,
      exit_code: 0,
      fullOutput: "",
      processExitObserved: true,
    });
    assert.deepEqual(complete.map((item) => item.passed), [true, true, true]);
    assert.deepEqual(noReloadResponse.map((item) => item.passed), [true, false, true]);
  });

  it("requires the registered extension command and exact native-shell Pi version", () => {
    assert.equal(behaviorAssertions("extension_load", { registeredCommands: [previewCommand] })[0].passed, true);
    assert.equal(behaviorAssertions("extension_load", { registeredCommands: [] })[0].passed, false);
    assert.equal(behaviorAssertions("host_shell", { exit_code: 0, fullOutput: "1.1.0\n", expectedVersion: "1.1.0" })[0].passed, true);
    assert.equal(behaviorAssertions("host_shell", { exit_code: 0, fullOutput: "0.99.2\n", expectedVersion: "1.1.0" })[0].passed, false);
  });
});


it("host stdin errors are surfaced instead of hanging the case", () => {
  const source = readFileSync(new URL("./pi-sdk-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /child\.stdin\.on\("error"/, "must listen for stdin errors");
  assert.match(source, /stdinErrors\.push/, "must record the error");
  assert.match(source, /stdinErrors\.length === 0/, "must fail the case when stdin errored");
});
