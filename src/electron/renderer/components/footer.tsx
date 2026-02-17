import { Separator } from "@/components/ui/separator";

type FooterProps = {
  statusText: string;
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-secondary font-mono text-[10px] text-secondary-foreground">
      {children}
    </kbd>
  );
}

export function Footer({ statusText }: FooterProps) {
  return (
    <div className="border-t border-border px-4 py-1.5 flex items-center gap-2 text-xs text-muted-foreground h-8 shrink-0">
      <Kbd>Space</Kbd>
      <span>pause</span>
      <Separator orientation="vertical" className="h-3 mx-0.5" />
      <Kbd>{"\u2191\u2193"}</Kbd>
      <span>scroll</span>
      <Separator orientation="vertical" className="h-3 mx-0.5" />
      <Kbd>Q</Kbd>
      <span>back</span>
      {statusText && (
        <>
          <Separator orientation="vertical" className="h-3 mx-0.5" />
          <span className="font-mono text-muted-foreground truncate">
            {statusText}
          </span>
        </>
      )}
    </div>
  );
}
