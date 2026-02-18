"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  ChevronDownIcon,
  DotIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  ComponentProps,
  HTMLAttributes,
  ReactNode,
} from "react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ChainOfThoughtContextValue = {
  isStreaming: boolean;
};

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue>({
  isStreaming: false,
});

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export function ChainOfThought({
  className,
  isStreaming = false,
  defaultOpen = false,
  open,
  onOpenChange,
  ...props
}: ChainOfThoughtProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const prevStreaming = useRef(isStreaming);
  const currentOpen = isControlled ? open : uncontrolledOpen;

  useEffect(() => {
    if (prevStreaming.current === isStreaming) return;
    prevStreaming.current = isStreaming;
    if (!isControlled) {
      setUncontrolledOpen(isStreaming);
    }
    onOpenChange?.(isStreaming);
  }, [isControlled, isStreaming, onOpenChange]);

  return (
    <ChainOfThoughtContext.Provider value={{ isStreaming }}>
      <Collapsible
        className={cn("w-full", className)}
        onOpenChange={(nextOpen) => {
          if (!isControlled) setUncontrolledOpen(nextOpen);
          onOpenChange?.(nextOpen);
        }}
        open={currentOpen}
        {...props}
      />
    </ChainOfThoughtContext.Provider>
  );
}

export type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger>;

export function ChainOfThoughtHeader({
  children,
  className,
  ...props
}: ChainOfThoughtHeaderProps) {
  const { isStreaming } = useContext(ChainOfThoughtContext);

  return (
    <CollapsibleTrigger
      className={cn(
        "group/cot-trigger flex w-full items-center gap-1 rounded-none px-0 py-0 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">
        {children ?? "Chain of thought"}
      </span>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {isStreaming ? "running" : "done"}
      </span>
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/60 transition-transform group-data-[state=open]/cot-trigger:rotate-180" />
    </CollapsibleTrigger>
  );
}

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>;

export function ChainOfThoughtContent({
  className,
  ...props
}: ChainOfThoughtContentProps) {
  return (
    <CollapsibleContent
      className={cn("pl-3 pr-0 pb-0.5 pt-0.5", className)}
      {...props}
    />
  );
}

export type ChainOfThoughtStepStatus = "complete" | "active" | "pending";

export type ChainOfThoughtStepProps = HTMLAttributes<HTMLDivElement> & {
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: ChainOfThoughtStepStatus;
};

function StatusIcon({ status }: { status: ChainOfThoughtStepStatus }) {
  if (status === "active") {
    return <LoaderCircleIcon className="size-3 animate-spin text-primary" />;
  }
  if (status === "complete") {
    return <CheckIcon className="size-3 text-primary" />;
  }
  return <DotIcon className="size-3 text-muted-foreground" />;
}

export function ChainOfThoughtStep({
  icon: Icon = DotIcon,
  label,
  description,
  status = "complete",
  className,
  children,
  ...props
}: ChainOfThoughtStepProps) {
  return (
    <div
      className={cn(
        "rounded-none border border-border/50 px-1.5 py-1",
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-1.5">
        <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground/80" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline">
            {label}
          </div>
          {description ? (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {description}
            </div>
          ) : null}
        </div>
        <StatusIcon status={status} />
      </div>
      {children ? <div className="pt-1">{children}</div> : null}
    </div>
  );
}

export type ChainOfThoughtSearchResultsProps = HTMLAttributes<HTMLDivElement>;

export function ChainOfThoughtSearchResults({
  className,
  ...props
}: ChainOfThoughtSearchResultsProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1", className)}
      {...props}
    />
  );
}

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export function ChainOfThoughtSearchResult({
  className,
  variant = "outline",
  ...props
}: ChainOfThoughtSearchResultProps) {
  return (
    <Badge
      className={cn("h-4 px-1.5 py-0 text-[10px] font-normal", className)}
      variant={variant}
      {...props}
    />
  );
}

export type ChainOfThoughtImageProps = HTMLAttributes<HTMLDivElement> & {
  caption?: ReactNode;
};

export function ChainOfThoughtImage({
  caption,
  className,
  children,
  ...props
}: ChainOfThoughtImageProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      {children}
      {caption ? (
        <p className="text-[10px] text-muted-foreground/80">{caption}</p>
      ) : null}
    </div>
  );
}
