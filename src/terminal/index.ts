import "dotenv/config";

import { Session, parseArgs, validateEnv, printHelp, log, toReadableError, formatDevices, listAvfoundationDevices, checkMacOSVersion } from "../core";
import { createBlessedUI, type BlessedUI } from "./ui-blessed";
import { showIntroScreen } from "./intro-screen";

let globalUI: BlessedUI | null = null;
let isShuttingDown = false;

function showFatalError(label: string, msg: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const fullMsg = `${label}: ${msg}`;
  log("ERROR", fullMsg);

  if (globalUI) {
    try {
      globalUI.setStatus(`\u274C ${fullMsg}`);
      globalUI.render();
    } catch {
      // UI already destroyed
    }
    setTimeout(() => {
      try {
        globalUI?.destroy();
      } catch {
        // Ignore
      }
      console.error(fullMsg);
      process.exit(1);
    }, 3000);
  } else {
    console.error(fullMsg);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  const isAbortError =
    (reason instanceof Error && reason.name === "AbortError") ||
    (reason && typeof reason === "object" && "name" in reason && (reason as { name: string }).name === "AbortError");

  if (isAbortError) {
    log("WARN", "Unhandled AbortError (timeout) - suppressed");
    return;
  }

  const msg = toReadableError(reason);
  log("ERROR", `Unhandled rejection: ${msg}`);
  showFatalError("Unhandled rejection", msg);
});

process.on("uncaughtException", (err) => {
  log("ERROR", `Uncaught exception: ${err.message}\n${err.stack}`);
  showFatalError("Uncaught exception", err.message);
});

process.on("exit", (code) => {
  log("INFO", `Process exiting with code ${code}`);
  if (code !== 0 && !isShuttingDown) {
    console.error(`Process exiting with code ${code}`);
  }
});

async function main() {
  const config = parseArgs(process.argv.slice(2));
  log("INFO", "Starting translator");

  if (config.help) {
    printHelp();
    return;
  }

  if (config.listDevices) {
    if (config.legacyAudio) {
      try {
        const devices = await listAvfoundationDevices();
        console.log(formatDevices(devices));
      } catch (error) {
        console.error(`Unable to list devices. Is ffmpeg installed? ${toReadableError(error)}`);
      }
    } else {
      console.log("Device listing not needed - using ScreenCaptureKit for system audio.");
      console.log("Add --legacy-audio flag to list AVFoundation devices.");
    }
    return;
  }

  const { supported: macOSSupported, version: macOSVersion } = checkMacOSVersion();
  if (!config.legacyAudio && !macOSSupported) {
    console.error(`ScreenCaptureKit requires macOS 14.2 or later (detected macOS ${macOSVersion}).`);
    console.error("Use --legacy-audio flag with a loopback device (BlackHole) instead.");
    return;
  }

  if (!config.skipIntro) {
    const selection = await showIntroScreen();
    config.sourceLang = selection.sourceLang;
    config.targetLang = selection.targetLang;
  }

  log("INFO", `Languages: ${config.sourceLang} \u2192 ${config.targetLang}`);

  try {
    validateEnv(config);
  } catch (error) {
    console.error(toReadableError(error));
    process.exit(1);
  }

  const session = new Session(config);

  let ui: BlessedUI;
  try {
    ui = createBlessedUI();
    globalUI = ui;
  } catch (error) {
    console.error(`Failed to initialize UI: ${toReadableError(error)}`);
    process.exit(1);
  }

  // Wire session events to blessed UI
  session.events.on("state-change", (state) => ui.updateHeader(state));
  session.events.on("block-added", (block) => ui.addBlock(block));
  session.events.on("block-updated", (block) => ui.updateBlock(block));
  session.events.on("blocks-cleared", () => ui.clearBlocks());
  session.events.on("summary-updated", (summary) => ui.updateSummary(summary));
  session.events.on("cost-updated", (cost) => ui.updateCost(cost));
  session.events.on("status", (text) => ui.setStatus(text));
  session.events.on("error", (text) => ui.setStatus(`\u274C ${text}`));

  function shutdown(reason = "unknown") {
    log("INFO", `Shutdown called: ${reason}`);
    session.shutdown();
    ui.destroy();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));

  ui.screen.key(["q", "C-c"], () => shutdown("blessed key q/C-c"));
  ui.screen.key(["space"], () => {
    if (session.recording) session.stopRecording();
    else void session.startRecording();
  });

  ui.updateHeader(session.getUIState("idle"));
  ui.render();

  try {
    await session.initialize();
  } catch (error) {
    ui.setStatus(`Init error: ${toReadableError(error)}`);
    ui.render();
  }

  await session.startRecording();
}

main().catch((e) => {
  showFatalError("Fatal", toReadableError(e));
});
