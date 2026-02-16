import type { Summary } from "../../../core/types";

type SummaryPanelProps = {
  summary: Summary | null;
};

export function SummaryPanel({ summary }: SummaryPanelProps) {
  return (
    <div className="border-b border-slate-700 px-4 py-2 min-h-[80px] max-h-[120px] overflow-y-auto">
      <h2 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">
        Summary
      </h2>
      {summary ? (
        <ul className="space-y-0.5">
          {summary.keyPoints.map((point, i) => (
            <li key={i} className="text-sm text-slate-300 flex gap-2">
              <span className="text-cyan-400 shrink-0">{"\u2022"}</span>
              {point}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 italic">
          Waiting for conversation... Summary will appear after 30s of speech.
        </p>
      )}
    </div>
  );
}
