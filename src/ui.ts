import blessed from "blessed";
import type { UiElements } from "./types";

export function createUi(): UiElements {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Realtime Translator",
    fullUnicode: true,
    forceUnicode: true,
  });

  const transcriptBox = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-1",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    scrollbar: { ch: " ", track: { bg: "gray" }, style: { inverse: true } },
  });

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    style: { bg: "blue", fg: "white" },
    tags: false,
  });

  screen.append(transcriptBox);
  screen.append(statusBar);

  return { screen, transcriptBox, statusBar };
}

export function enableTranscriptScrolling(
  transcriptBox: blessed.Widgets.BoxElement,
  isAtBottom: () => boolean,
  setFollow: (value: boolean) => void
) {
  transcriptBox.focus();
  transcriptBox.on("scroll", () => {
    setFollow(isAtBottom());
  });
  transcriptBox.on("wheeldown", () => {
    setFollow(false);
  });
  transcriptBox.on("wheelup", () => {
    setFollow(false);
  });
  transcriptBox.on("keypress", (_ch, key) => {
    if (
      ["up", "down", "pageup", "pagedown", "home", "end"].includes(key.name)
    ) {
      setFollow(false);
    }
  });
}

export function formatLine(label: "KR" | "EN", text: string) {
  return `{bold}${label}:{/bold} ${text}`;
}

export function formatPartialLine(text: string) {
  return `{dim}... ${text}{/dim}`;
}
