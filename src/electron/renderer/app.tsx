import { useState } from "react";
import { IntroScreen } from "./screens/intro-screen";
import { MainScreen } from "./screens/main-screen";
import type { LanguageCode } from "../../core/types";

type AppState =
  | { kind: "intro" }
  | { kind: "main"; sourceLang: LanguageCode; targetLang: LanguageCode };

export function App() {
  const [state, setState] = useState<AppState>({ kind: "intro" });

  if (state.kind === "intro") {
    return (
      <IntroScreen
        onStart={(sourceLang, targetLang) =>
          setState({ kind: "main", sourceLang, targetLang })
        }
      />
    );
  }

  return (
    <MainScreen
      sourceLang={state.sourceLang}
      targetLang={state.targetLang}
      onBack={() => setState({ kind: "intro" })}
    />
  );
}
