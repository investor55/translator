import { ScrollArea } from "@/components/ui/scroll-area";
import type { Language, LanguageCode } from "../../../core/types";

type LanguagePickerProps = {
  languages: Language[];
  selected: LanguageCode;
  onSelect: (code: LanguageCode) => void;
  focused: boolean;
  onFocus: () => void;
};

export function LanguagePicker({
  languages,
  selected,
  onSelect,
  focused,
  onFocus,
}: LanguagePickerProps) {
  return (
    <div
      className={`flex-1 rounded-lg border transition-colors min-h-0 ${
        focused ? "border-foreground/30" : "border-border"
      }`}
      onClick={onFocus}
    >
      <ScrollArea className="h-full">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => {
              onFocus();
              onSelect(lang.code);
            }}
            className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
              selected === lang.code
                ? focused
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-secondary text-secondary-foreground"
                : "text-foreground hover:bg-accent"
            }`}
          >
            <span className="inline-block w-8 font-mono text-xs opacity-60">
              {lang.code.toUpperCase()}
            </span>
            <span className="font-sans">{lang.name}</span>
            <span className="text-muted-foreground ml-2">({lang.native})</span>
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}
