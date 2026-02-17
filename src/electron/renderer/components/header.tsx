import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { UIState } from "../../../core/types";

type HeaderProps = {
  uiState: UIState | null;
};

function StatusBadge({ status }: { status: UIState["status"] }) {
  const config = {
    idle: { color: "bg-status-idle", label: "Idle" },
    connecting: { color: "bg-status-connecting", label: "Connecting..." },
    recording: { color: "bg-status-recording", label: "Recording" },
    paused: { color: "bg-status-paused", label: "Paused" },
  }[status];

  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.color} ${
          status === "recording" ? "animate-pulse" : ""
        }`}
      />
      {config.label}
    </Badge>
  );
}

export function Header({ uiState }: HeaderProps) {
  if (!uiState) {
    return (
      <div className="titlebar-drag border-b border-border px-4 py-2 flex items-center gap-3 h-10">
        <span className="font-mono font-bold text-foreground titlebar-no-drag">
          Rosetta
        </span>
      </div>
    );
  }

  return (
    <div className="titlebar-drag border-b border-border px-4 py-2 flex items-center gap-3 h-10 text-sm">
      <span className="font-mono font-bold text-foreground titlebar-no-drag">
        Rosetta
      </span>
      <Separator orientation="vertical" className="h-4" />
      <span className="titlebar-no-drag">
        <StatusBadge status={uiState.status} />
      </span>
      {uiState.cost > 0 && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <span className="font-mono text-muted-foreground">
            ${uiState.cost.toFixed(4)}
          </span>
        </>
      )}
      {uiState.contextLoaded && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          CTX
        </Badge>
      )}
      <span className="ml-auto text-muted-foreground font-mono text-xs truncate max-w-48">
        {uiState.modelId}
      </span>
    </div>
  );
}
