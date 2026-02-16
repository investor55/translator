type FooterProps = {
  statusText: string;
};

export function Footer({ statusText }: FooterProps) {
  return (
    <div className="border-t border-slate-700 px-4 py-1.5 flex items-center gap-2 text-xs text-slate-500 h-8 shrink-0">
      <span>
        <span className="text-slate-400">SPACE</span> pause
      </span>
      <span className="text-slate-600">|</span>
      <span>
        <span className="text-slate-400">{"\u2191\u2193"}</span> scroll
      </span>
      <span className="text-slate-600">|</span>
      <span>
        <span className="text-slate-400">Q</span> back
      </span>
      {statusText && (
        <>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400 truncate">{statusText}</span>
        </>
      )}
    </div>
  );
}
