import blessed from "blessed";
import { SUPPORTED_LANGUAGES, type IntroSelection } from "../core/types";

const PIXEL_ART = `
{cyan-fg}
          \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557
          \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557
          \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2557     \u2588\u2588\u2551      \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551
          \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551\u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D     \u2588\u2588\u2551      \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551
          \u2588\u2588\u2551  \u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2551      \u2588\u2588\u2551   \u2588\u2588\u2551  \u2588\u2588\u2551
          \u255A\u2550\u255D  \u255A\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D   \u255A\u2550\u255D      \u255A\u2550\u255D   \u255A\u2550\u255D  \u255A\u2550\u255D

              {white-fg}\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510
              \u2502 {gray-fg}\u266A{/}{white-fg}  Real-time Audio Translation  {gray-fg}\u266A{/}{white-fg} \u2502
              \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518{/}
{/}`;

const SMALL_PIXEL_ART = `
{cyan-fg}
        \u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E
        \u2502 {white-fg}\u2588\u2580\u2588 \u2588\u2580\u2588 \u2588\u2580 \u2588\u2580\u2580 \u2580\u2588\u2580 \u2580\u2588\u2580 \u2584\u2580\u2588{/}          \u2502
        \u2502 {white-fg}\u2588\u2580\u2584 \u2588\u2584\u2588 \u2584\u2588 \u2588\u2588\u2584  \u2588   \u2588  \u2588\u2580\u2588{/}          \u2502
        \u2502    {gray-fg}\u266A Real-time Audio Translation \u266A{/}   \u2502
        \u256E\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F
{/}`;

export function showIntroScreen(): Promise<IntroSelection> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: "Rosetta - Language Selection",
    });

    const termWidth = typeof screen.width === "number" ? screen.width : 80;
    const useSmallArt = termWidth < 80;
    const artHeight = useSmallArt ? 8 : 12;

    const logo = blessed.box({
      top: 0,
      left: "center",
      width: "100%",
      height: artHeight,
      tags: true,
      content: useSmallArt ? SMALL_PIXEL_ART : PIXEL_ART,
    });

    const selectorContainer = blessed.box({
      top: artHeight + 1,
      left: "center",
      width: "80%",
      height: "100%-" + (artHeight + 6),
      tags: true,
    });

    blessed.text({
      parent: selectorContainer,
      top: 0,
      left: 0,
      width: "50%",
      tags: true,
      content: "{bold}{cyan-fg}INPUT LANGUAGE (what you hear):{/}",
    });

    blessed.text({
      parent: selectorContainer,
      top: 0,
      left: "50%",
      width: "50%",
      tags: true,
      content: "{bold}{cyan-fg}OUTPUT LANGUAGE (translation):{/}",
    });

    const sourceList = blessed.list({
      parent: selectorContainer,
      top: 2,
      left: 0,
      width: "48%",
      height: "100%-4",
      border: { type: "line" },
      style: {
        border: { fg: "cyan" },
        selected: { bg: "cyan", fg: "black", bold: true },
        item: { fg: "white" },
        focus: { border: { fg: "white" } },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: "\u2588",
        track: { bg: "gray" },
        style: { bg: "cyan" },
      },
      items: SUPPORTED_LANGUAGES.map(
        (l) => ` ${l.code.toUpperCase()}  ${l.name} (${l.native})`
      ),
    });

    const targetList = blessed.list({
      parent: selectorContainer,
      top: 2,
      left: "52%",
      width: "48%",
      height: "100%-4",
      border: { type: "line" },
      style: {
        border: { fg: "cyan" },
        selected: { bg: "cyan", fg: "black", bold: true },
        item: { fg: "white" },
        focus: { border: { fg: "white" } },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: "\u2588",
        track: { bg: "gray" },
        style: { bg: "cyan" },
      },
      items: SUPPORTED_LANGUAGES.map(
        (l) => ` ${l.code.toUpperCase()}  ${l.name} (${l.native})`
      ),
    });

    const footer = blessed.box({
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      content:
        "{center}{gray-fg}\u2190\u2192:{/} switch panels  {gray-fg}\u2191\u2193:{/} navigate  {gray-fg}ENTER:{/} start  {gray-fg}Q:{/} quit{/center}",
    });

    const statusBar = blessed.box({
      bottom: 3,
      left: 0,
      width: "100%",
      height: 2,
      tags: true,
      content: "",
    });

    screen.append(logo);
    screen.append(selectorContainer);
    screen.append(footer);
    screen.append(statusBar);

    const koIndex = SUPPORTED_LANGUAGES.findIndex((l) => l.code === "ko");
    const enIndex = SUPPORTED_LANGUAGES.findIndex((l) => l.code === "en");
    sourceList.select(koIndex);
    targetList.select(enIndex);

    let currentFocus: "source" | "target" = "source";
    sourceList.focus();
    applyFocusStyles(sourceList, targetList);

    function updateStatus() {
      const sourceIdx = sourceList.selected as number;
      const targetIdx = targetList.selected as number;
      const sourceLang = SUPPORTED_LANGUAGES[sourceIdx];
      const targetLang = SUPPORTED_LANGUAGES[targetIdx];

      const arrow = "{cyan-fg}  \u2500\u2500\u25BA  {/}";
      statusBar.setContent(
        `{center}{bold}Selected: {green-fg}${sourceLang.name}{/}${arrow}{green-fg}${targetLang.name}{/}{/center}`
      );
      screen.render();
    }

    function applyFocusStyles(focused: blessed.Widgets.ListElement, unfocused: blessed.Widgets.ListElement) {
      focused.style.border.fg = "white";
      focused.style.selected = { bg: "cyan", fg: "black", bold: true };
      unfocused.style.border.fg = "cyan";
      unfocused.style.selected = { bg: "gray", fg: "white", bold: false };
    }

    function switchFocus() {
      if (currentFocus === "source") {
        currentFocus = "target";
        targetList.focus();
        applyFocusStyles(targetList, sourceList);
      } else {
        currentFocus = "source";
        sourceList.focus();
        applyFocusStyles(sourceList, targetList);
      }
      screen.render();
    }

    screen.key(["left", "right"], switchFocus);

    sourceList.on("select item", updateStatus);
    targetList.on("select item", updateStatus);

    screen.key(["enter"], () => {
      const sourceIdx = sourceList.selected as number;
      const targetIdx = targetList.selected as number;
      const sourceLang = SUPPORTED_LANGUAGES[sourceIdx].code;
      const targetLang = SUPPORTED_LANGUAGES[targetIdx].code;

      if (sourceLang === targetLang) {
        statusBar.setContent(
          "{center}{red-fg}{bold}Error: Source and target languages must be different!{/}{/center}"
        );
        screen.render();
        return;
      }

      screen.destroy();
      resolve({ sourceLang, targetLang });
    });

    screen.key(["q", "C-c"], () => {
      screen.destroy();
      process.exit(0);
    });

    updateStatus();
    screen.render();
  });
}
