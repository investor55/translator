import blessed from "blessed";
import type { TranscriptBlock } from "./ui";
import type { Summary } from "./types";

export type UIState = {
  deviceName: string;
  modelId: string;
  intervalMs: number;
  status: "idle" | "connecting" | "recording" | "paused";
  contextLoaded: boolean;
};

export type BlessedUI = {
  screen: blessed.Widgets.Screen;
  updateHeader: (state: UIState) => void;
  updateSummary: (summary: Summary | null) => void;
  addBlock: (block: TranscriptBlock) => void;
  updateBlock: (block: TranscriptBlock) => void;
  clearBlocks: () => void;
  setStatus: (text: string) => void;
  render: () => void;
  destroy: () => void;
};

const COLORS = {
  border: "cyan",
  title: "white",
  label: "cyan",
  text: "white",
  dim: "gray",
};

export function createBlessedUI(): BlessedUI {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true, // Enable proper CJK width calculation for Korean/Chinese/Japanese
    title: "Rosetta",
    cursor: { artificial: true, shape: "line", blink: true, color: null },
  });

  // Header box - top
  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: COLORS.border },
    },
  });

  // Summary box - below header
  const summary = blessed.box({
    top: 3,
    left: 0,
    width: "100%",
    height: 6,
    tags: true,
    border: { type: "line" },
    label: " SUMMARY ",
    style: {
      border: { fg: COLORS.border },
      label: { fg: COLORS.label, bold: true },
    },
  });

  // Transcript list - main scrollable area
  const transcriptBox = blessed.box({
    top: 9,
    left: 0,
    width: "100%",
    height: "100%-12",
    tags: true,
    border: { type: "line" },
    label: " LIVE TRANSCRIPT ",
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: "█",
      track: { bg: "gray" },
      style: { bg: "cyan" },
    },
    keys: true,
    vi: true,
    mouse: true,
    style: {
      border: { fg: COLORS.border },
      label: { fg: COLORS.label, bold: true },
    },
  });

  // Footer box - controls help
  const footer = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: COLORS.border },
    },
  });

  screen.append(header);
  screen.append(summary);
  screen.append(transcriptBox);
  screen.append(footer);

  // Store blocks for rendering
  const blocks: TranscriptBlock[] = [];
  let currentSummary: Summary | null = null;
  let statusText = "";
  let uiState: UIState = {
    deviceName: "",
    modelId: "",
    intervalMs: 3000,
    status: "idle",
    contextLoaded: false,
  };

  // Track label colors across all renders
  const labelColors: Record<string, string> = {};
  const availableColors = ["green", "cyan", "yellow", "magenta", "blue"];
  let nextColorIndex = 0;

  function getColorForLabel(label: string): string {
    if (!labelColors[label]) {
      labelColors[label] = availableColors[nextColorIndex % availableColors.length];
      nextColorIndex++;
    }
    return labelColors[label];
  }

  function getStatusLabel(status: UIState["status"]): string {
    switch (status) {
      case "idle":
        return "{gray-fg}Idle{/}";
      case "connecting":
        return "{yellow-fg}Connecting...{/}";
      case "recording":
        return "{green-fg}● Recording{/}";
      case "paused":
        return "{yellow-fg}Paused{/}";
    }
  }

  function renderHeader() {
    const interval = `${(uiState.intervalMs / 1000).toFixed(1)}s`;
    const statusLabel = getStatusLabel(uiState.status);
    const contextLabel = uiState.contextLoaded ? " {cyan-fg}[CTX]{/}" : "";

    header.setContent(
      `{bold}{cyan-fg}◈ Rosetta{/}  {gray-fg}│{/}  ` +
      `{gray-fg}Device:{/} ${uiState.deviceName}  {gray-fg}│{/}  ` +
      `{gray-fg}Interval:{/} ${interval}  {gray-fg}│{/}  ` +
      `${statusLabel}${contextLabel}  {gray-fg}│{/}  ` +
      `${uiState.modelId}`
    );
  }

  function renderSummary() {
    if (!currentSummary) {
      summary.setContent("{gray-fg}Waiting for conversation... Summary will appear after 30s of speech.{/}");
      return;
    }

    const elapsed = Math.floor((Date.now() - currentSummary.updatedAt) / 1000);
    const updatedLabel = elapsed < 60 ? `${elapsed}s ago` : `${Math.floor(elapsed / 60)}m ago`;

    let content = "";
    for (const point of currentSummary.keyPoints.slice(0, 4)) {
      content += `  {cyan-fg}•{/} ${point}\n`;
    }
    content += `{gray-fg}Updated: ${updatedLabel}{/}`;

    summary.setContent(content);
  }

  function renderBlocks() {
    if (blocks.length === 0) {
      transcriptBox.setContent("{gray-fg}Speak to see transcriptions here...{/}");
      return;
    }

    const lines: string[] = [];
    for (const block of blocks) {
      const index = block.id.toString().padStart(3, "0");
      const sourceColor = getColorForLabel(block.sourceLabel);
      const targetColor = getColorForLabel(block.targetLabel);

      lines.push(`{gray-fg}— ${index} —{/}`);
      lines.push(`{bold}{${sourceColor}-fg}${block.sourceLabel}:{/} ${block.sourceText}`);

      // Skip translation line when source equals target (transcription mode)
      const isTranscriptionOnly = block.sourceLabel === block.targetLabel;
      if (!isTranscriptionOnly) {
        if (block.translation) {
          lines.push(`{bold}{${targetColor}-fg}${block.targetLabel}:{/} ${block.translation}`);
        } else {
          lines.push(`{gray-fg}${block.targetLabel}: …{/}`);
        }
      }
      lines.push("");
    }

    transcriptBox.setContent(lines.join("\n"));
    // Auto-scroll to bottom
    transcriptBox.setScrollPerc(100);
  }

  function renderFooter() {
    let content = "{gray-fg}SPACE:{/} pause  {gray-fg}│{/}  {gray-fg}Q:{/} quit  {gray-fg}│{/}  {gray-fg}↑↓:{/} scroll";
    if (statusText) {
      content += `  {gray-fg}│{/}  ${statusText}`;
    }
    footer.setContent(content);
  }

  function render() {
    renderHeader();
    renderSummary();
    renderBlocks();
    renderFooter();
    screen.render();
  }

  // Key bindings
  screen.key(["up", "k"], () => {
    transcriptBox.scroll(-1);
    screen.render();
  });

  screen.key(["down", "j"], () => {
    transcriptBox.scroll(1);
    screen.render();
  });

  screen.key(["pageup"], () => {
    transcriptBox.scroll(-10);
    screen.render();
  });

  screen.key(["pagedown"], () => {
    transcriptBox.scroll(10);
    screen.render();
  });

  return {
    screen,

    updateHeader(state: UIState) {
      uiState = state;
      renderHeader();
      screen.render();
    },

    updateSummary(s: Summary | null) {
      currentSummary = s;
      renderSummary();
      screen.render();
    },

    addBlock(block: TranscriptBlock) {
      blocks.push(block);
      renderBlocks();
      screen.render();
    },

    updateBlock(block: TranscriptBlock) {
      const idx = blocks.findIndex((b) => b.id === block.id);
      if (idx >= 0) {
        blocks[idx] = block;
        renderBlocks();
        screen.render();
      }
    },

    clearBlocks() {
      blocks.length = 0;
      renderBlocks();
      screen.render();
    },

    setStatus(text: string) {
      statusText = text;
      renderFooter();
      screen.render();
    },

    render,

    destroy() {
      screen.destroy();
    },
  };
}
