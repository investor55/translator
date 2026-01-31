import blessed from "blessed";

export type LanguageCode =
  | "en" | "es" | "fr" | "de" | "it" | "pt"
  | "zh" | "ja" | "ko" | "ar" | "hi" | "ru";

export type Language = {
  code: LanguageCode;
  name: string;
  native: string;
};

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "ru", name: "Russian", native: "Русский" },
];

export type Engine = "vertex" | "elevenlabs";

export type IntroSelection = {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  engine: Engine;
};

const PIXEL_ART = `
{cyan-fg}
          ██████╗  ██████╗ ███████╗███████╗████████╗████████╗ █████╗
          ██╔══██╗██╔═══██╗██╔════╝██╔════╝╚══██╔══╝╚══██╔══╝██╔══██╗
          ██████╔╝██║   ██║███████╗█████╗     ██║      ██║   ███████║
          ██╔══██╗██║   ██║╚════██║██╔══╝     ██║      ██║   ██╔══██║
          ██║  ██║╚██████╔╝███████║███████╗   ██║      ██║   ██║  ██║
          ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝

              {white-fg}┌───────────────────────────────────────┐
              │ {gray-fg}♪{/}{white-fg}  Real-time Audio Translation  {gray-fg}♪{/}{white-fg} │
              └───────────────────────────────────────┘{/}
{/}`;

const SMALL_PIXEL_ART = `
{cyan-fg}
        ╭──────────────────────────────────────╮
        │ {white-fg}█▀█ █▀█ █▀ █▀▀ ▀█▀ ▀█▀ ▄▀█{/}          │
        │ {white-fg}█▀▄ █▄█ ▄█ ██▄  █   █  █▀█{/}          │
        │    {gray-fg}♪ Real-time Audio Translation ♪{/}   │
        ╰──────────────────────────────────────╯
{/}`;

export function showIntroScreen(): Promise<IntroSelection> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: "Rosetta - Language Selection",
    });

    // Determine which art to use based on terminal width
    const termWidth = typeof screen.width === "number" ? screen.width : 80;
    const useSmallArt = termWidth < 80;
    const artHeight = useSmallArt ? 8 : 12;

    // Title/Logo
    const logo = blessed.box({
      top: 0,
      left: "center",
      width: "100%",
      height: artHeight,
      tags: true,
      content: useSmallArt ? SMALL_PIXEL_ART : PIXEL_ART,
    });

    // Engine selector bar
    let selectedEngine: Engine = "vertex";
    const engineBar = blessed.box({
      top: artHeight,
      left: "center",
      width: "80%",
      height: 3,
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
    });

    function renderEngineBar() {
      const vertexStyle = selectedEngine === "vertex"
        ? "{cyan-bg}{black-fg}{bold}" : "{gray-fg}";
      const elevenStyle = selectedEngine === "elevenlabs"
        ? "{cyan-bg}{black-fg}{bold}" : "{gray-fg}";
      engineBar.setContent(
        `{center}ENGINE:  ${vertexStyle} Vertex AI (Gemini) {/}    ${elevenStyle} ElevenLabs + Bedrock {/}{/center}`
      );
    }

    // Container for language selectors
    const selectorContainer = blessed.box({
      top: artHeight + 4,
      left: "center",
      width: "80%",
      height: "100%-" + (artHeight + 9),
      tags: true,
    });

    // Source language label (attached via parent)
    blessed.text({
      parent: selectorContainer,
      top: 0,
      left: 0,
      width: "50%",
      tags: true,
      content: "{bold}{cyan-fg}INPUT LANGUAGE (what you hear):{/}",
    });

    // Target language label (attached via parent)
    blessed.text({
      parent: selectorContainer,
      top: 0,
      left: "50%",
      width: "50%",
      tags: true,
      content: "{bold}{cyan-fg}OUTPUT LANGUAGE (translation):{/}",
    });

    // Source language list
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
        ch: "█",
        track: { bg: "gray" },
        style: { bg: "cyan" },
      },
      items: SUPPORTED_LANGUAGES.map(
        (l) => ` ${l.code.toUpperCase()}  ${l.name} (${l.native})`
      ),
    });

    // Target language list
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
        ch: "█",
        track: { bg: "gray" },
        style: { bg: "cyan" },
      },
      items: SUPPORTED_LANGUAGES.map(
        (l) => ` ${l.code.toUpperCase()}  ${l.name} (${l.native})`
      ),
    });

    // Footer with instructions
    const footer = blessed.box({
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      content:
        "{center}{gray-fg}←→:{/} switch panels  {gray-fg}↑↓:{/} navigate  {gray-fg}TAB:{/} toggle engine  {gray-fg}ENTER:{/} start  {gray-fg}Q:{/} quit{/center}",
    });

    // Status bar showing current selection
    const statusBar = blessed.box({
      bottom: 3,
      left: 0,
      width: "100%",
      height: 2,
      tags: true,
      content: "",
    });

    screen.append(logo);
    screen.append(engineBar);
    screen.append(selectorContainer);
    screen.append(footer);
    screen.append(statusBar);

    // Set default selections (Korean -> English)
    const koIndex = SUPPORTED_LANGUAGES.findIndex((l) => l.code === "ko");
    const enIndex = SUPPORTED_LANGUAGES.findIndex((l) => l.code === "en");
    sourceList.select(koIndex);
    targetList.select(enIndex);

    let currentFocus: "source" | "target" = "source";
    sourceList.focus();
    renderEngineBar();

    function updateStatus() {
      const sourceIdx = sourceList.selected as number;
      const targetIdx = targetList.selected as number;
      const sourceLang = SUPPORTED_LANGUAGES[sourceIdx];
      const targetLang = SUPPORTED_LANGUAGES[targetIdx];

      const arrow = "{cyan-fg}  ──►  {/}";
      statusBar.setContent(
        `{center}{bold}Selected: {green-fg}${sourceLang.name}{/}${arrow}{green-fg}${targetLang.name}{/}{/center}`
      );
      screen.render();
    }

    function switchFocus() {
      if (currentFocus === "source") {
        currentFocus = "target";
        targetList.focus();
        sourceList.style.border.fg = "cyan";
        targetList.style.border.fg = "white";
      } else {
        currentFocus = "source";
        sourceList.focus();
        targetList.style.border.fg = "cyan";
        sourceList.style.border.fg = "white";
      }
      screen.render();
    }

    // Left/Right arrows to switch between language panels
    screen.key(["left", "right"], switchFocus);

    // Tab to toggle engine
    screen.key(["tab"], () => {
      selectedEngine = selectedEngine === "vertex" ? "elevenlabs" : "vertex";
      renderEngineBar();
      screen.render();
    });

    // Update status on selection change
    sourceList.on("select item", updateStatus);
    targetList.on("select item", updateStatus);

    // Enter to confirm
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
      resolve({ sourceLang, targetLang, engine: selectedEngine });
    });

    // Q to quit
    screen.key(["q", "C-c"], () => {
      screen.destroy();
      process.exit(0);
    });

    // Initial status update
    updateStatus();
    screen.render();
  });
}

export function getLanguageName(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export function getLanguageLabel(code: LanguageCode): string {
  return code.toUpperCase();
}
