"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, LoaderCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ReasoningContextValue = {
  isOpen: boolean;
  isStreaming: boolean;
  duration?: number;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used inside <Reasoning />.");
  }
  return context;
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  duration?: number;
};

export function Reasoning({
  isStreaming = false,
  duration,
  open,
  defaultOpen = true,
  onOpenChange,
  className,
  children,
  ...props
}: ReasoningProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const currentOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  useEffect(() => {
    setOpen(isStreaming);
  }, [isStreaming, setOpen]);

  const contextValue = useMemo(
    () => ({ isOpen: currentOpen, isStreaming, duration }),
    [currentOpen, duration, isStreaming]
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        className={cn("w-full", className)}
        onOpenChange={setOpen}
        open={currentOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

export function ReasoningTrigger({
  getThinkingMessage,
  className,
  ...props
}: ReasoningTriggerProps) {
  const { isStreaming, duration } = useReasoning();

  const label =
    getThinkingMessage?.(isStreaming, duration) ??
    (isStreaming ? "Thinking..." : "Thought process");

  return (
    <CollapsibleTrigger
      className={cn(
        "group/reasoning-trigger flex w-full items-center gap-1.5 rounded-none px-0 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      {isStreaming && <LoaderCircleIcon className="size-3 animate-spin" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]/reasoning-trigger:rotate-180" />
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

export function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent className={cn("pl-4 pr-0 pb-1 pt-0.5", className)} {...props}>
      <div className="text-[11px] text-muted-foreground leading-relaxed [&_a]:text-primary [&_a]:underline">
        <MessageResponse>{children}</MessageResponse>
      </div>
    </CollapsibleContent>
  );
}

