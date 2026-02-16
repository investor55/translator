import { useEffect } from "react";

type KeyboardActions = {
  onToggleRecording: () => void;
  onQuit: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
};

export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          actions.onToggleRecording();
          break;
        case "KeyQ":
          if (!e.metaKey && !e.ctrlKey) {
            actions.onQuit();
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          actions.onScrollUp?.();
          break;
        case "ArrowDown":
          e.preventDefault();
          actions.onScrollDown?.();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions]);
}
