import type { Summary } from "../../../core/types";

type SummaryStripProps = {
  summary: Summary | null;
};

export function SummaryStrip({ summary }: SummaryStripProps) {
  if (!summary) return null;

  return (
    <div className="border-b border-border/50 px-4 py-1.5 max-h-20 overflow-y-auto shrink-0">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
          Summary
        </span>
        <span className="text-foreground font-sans">
          {summary.keyPoints.join(" · ")}
        </span>
      </div>
    </div>
  );
}
