export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function redactPaths(value, roots) {
  let result = String(value ?? "");
  for (const root of roots) {
    if (root) result = result.replaceAll(root, "<isolated-path>");
  }
  return result;
}

function handled(response) {
  return response?.success === true && response.data?.disposition === "handled";
}

export function behaviorAssertions(name, observation) {
  const {
    registeredCommands = [],
    promptResponse,
    editorRequest,
    notifications = [],
    exit_code,
    fullOutput = "",
    expectedVersion,
    processExitObserved = false,
    pathRoots = [],
  } = observation;
  const preview = registeredCommands.find((command) =>
    command?.name === "mdxml:preview" && command.source === "extension");

  if (name === "extension_load") {
    return [assertion(
      "extension_registered",
      "The actual Pi RPC command inventory contains this extension's mdxml:preview command",
      preview ? { name: preview.name, source: preview.source } : null,
      !!preview,
    )];
  }

  if (name === "happy_path" || name === "reload_cleanup") {
    const xml = editorRequest?.prefill ?? "";
    const converted = xml.includes('<markdown_context source="preview" path="wikilink.md"')
      && xml.includes('<wikilink target="Target Note" />')
      && xml.includes('<wikilink target="Other" alias="display label" />');
    const featureResponse = handled(promptResponse) && editorRequest?.method === "editor" && converted;
    const featureAssertion = assertion(
      name === "happy_path" ? "feature_response" : "reloaded_feature_response",
      "The actual Pi host handles /mdxml:preview and its editor response contains converted markdown XML, isolated-workspace provenance, and both wikilinks",
      {
        prompt: promptResponse ? { command: promptResponse.command, success: promptResponse.success, data: promptResponse.data } : null,
        editor: editorRequest ? { method: editorRequest.method, title: editorRequest.title, prefill: editorRequest.prefill } : null,
      },
      featureResponse,
    );
    if (name === "happy_path") return [featureAssertion];
    return [
      assertion(
        "reloaded_extension_registered",
        "A fresh second Pi process registers mdxml:preview",
        preview ? { name: preview.name, source: preview.source } : null,
        !!preview,
      ),
      featureAssertion,
      assertion(
        "clean_shutdown",
        "The second actual Pi host exits zero without unhandled exceptions or shutdown errors",
        { exit_code, process_exit_observed: processExitObserved, errors: UNHANDLED_ERROR_PATTERN.test(fullOutput) },
        exit_code === 0 && processExitObserved && !UNHANDLED_ERROR_PATTERN.test(fullOutput),
      ),
    ];
  }

  if (name === "error_path") {
    const errorNotification = notifications.find((event) =>
      event?.method === "notify" && event.notifyType === "error"
      && typeof event.message === "string" && event.message.startsWith("Failed to read "));
    const safeNotification = errorNotification ? {
      method: errorNotification.method,
      notifyType: errorNotification.notifyType,
      message: redactPaths(errorNotification.message, pathRoots),
    } : null;
    return [assertion(
      "handled_error",
      "A missing Markdown file produces the extension's handled read-error notification and the Pi command response is handled",
      {
        prompt: promptResponse ? { command: promptResponse.command, success: promptResponse.success, data: promptResponse.data } : null,
        notification: safeNotification,
      },
      handled(promptResponse) && !!errorNotification,
    )];
  }

  if (name === "host_shell") {
    const observed = { exit_code, output: fullOutput.trim(), expectedVersion };
    return [assertion(
      "native_shell_boundary",
      "The native host shell launches the locally installed Pi CLI and returns its exact SDK version",
      observed,
      exit_code === 0 && observed.output === expectedVersion,
    )];
  }

  throw new Error(`Unknown smoke case: ${name}`);
}
