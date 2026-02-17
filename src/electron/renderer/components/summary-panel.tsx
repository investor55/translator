import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Summary } from "../../../core/types";

type SummaryPanelProps = {
  summary: Summary | null;
};

export function SummaryPanel({ summary }: SummaryPanelProps) {
  return (
    <Card className="mx-4 mt-2 mb-1 shadow-sm">
      <CardHeader className="py-2 px-4">
        <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 min-h-[40px] max-h-[80px] overflow-y-auto">
        {summary ? (
          <ul className="space-y-0.5">
            {summary.keyPoints.map((point, i) => (
              <li key={i} className="text-sm text-foreground font-sans flex gap-2">
                <span className="text-muted-foreground shrink-0">{"\u2022"}</span>
                {point}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Waiting for conversation...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
