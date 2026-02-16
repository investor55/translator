import type { UIState } from "../../../core/types";

type HeaderProps = {
  uiState: UIState | null;
};

function StatusBadge({ status }: { status: UIState["status"] }) {
  switch (status) {
    case "idle":
      return <span className="text-slate-400">Idle</span>;
    case "connecting":
      return <span className="text-yellow-400">Connecting...</span>;
    case "recording":
      return (
        <span className="text-green-400">
          <span className="inline-block w-2 h-2 bg-green-400 rounded-full mr-1.5 animate-pulse" />
          Recording
        </span>
      );
    case "paused":
      return <span className="text-yellow-400">Paused</span>;
  }
}

export function Header({ uiState }: HeaderProps) {
  if (!uiState) {
    return (
      <div className="titlebar-drag border-b border-slate-700 px-4 py-2 flex items-center gap-3 h-10">
        <span className="text-cyan-400 font-bold">{"\u25C8"} Rosetta</span>
      </div>
    );
  }

  return (
    <div className="titlebar-drag border-b border-slate-700 px-4 py-2 flex items-center gap-3 h-10 text-sm">
      <span className="text-cyan-400 font-bold titlebar-no-drag">
        {"\u25C8"} Rosetta
      </span>
      <span className="text-slate-600">|</span>
      <StatusBadge status={uiState.status} />
      {uiState.cost > 0 && (
        <>
          <span className="text-slate-600">|</span>
          <span className="text-green-400">${uiState.cost.toFixed(4)}</span>
        </>
      )}
      {uiState.contextLoaded && (
        <span className="text-cyan-400 text-xs">[CTX]</span>
      )}
      <span className="text-slate-600">|</span>
      <span className="text-slate-400 truncate">{uiState.modelId}</span>
    </div>
  );
}
