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
      className={`flex-1 overflow-y-auto rounded border ${
        focused ? "border-white" : "border-slate-600"
      }`}
      onClick={onFocus}
    >
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
                ? "bg-cyan-500 text-black font-semibold"
                : "bg-slate-600 text-white"
              : "text-slate-300 hover:bg-slate-700"
          }`}
        >
          <span className="inline-block w-8 text-xs opacity-70">
            {lang.code.toUpperCase()}
          </span>
          {lang.name}
          <span className="text-slate-400 ml-2">({lang.native})</span>
        </button>
      ))}
    </div>
  );
}
