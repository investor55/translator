import {
  forwardRef,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranscriptBlock } from "../../../core/types";
import { LoaderCircleIcon, MicIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SelectionTodoResult = {
  ok: boolean;
  message?: string;
};

type TranscriptAreaProps = {
  blocks: TranscriptBlock[];
  systemPartial?: string;
  micPartial?: string;
  canTranslate?: boolean;
  onCreateTodoFromSelection?: (
    highlightedText: string,
    userIntentText?: string,
  ) => Promise<SelectionTodoResult>;
};

const PARAGRAPH_MAX_MS = 30_000;
const SELECTION_MENU_DEBOUNCE_MS = 180;

function groupIntoParagraphs(blocks: readonly TranscriptBlock[]): TranscriptBlock[][] {
  const paragraphs: TranscriptBlock[][] = [];
  let current: TranscriptBlock[] = [];
  let windowStart = 0;

  for (const block of blocks) {
    if (current.length === 0) {
      windowStart = block.createdAt;
      current.push(block);
      continue;
    }

    if (block.newTopic || block.createdAt - windowStart > PARAGRAPH_MAX_MS || block.audioSource !== current[0].audioSource) {
      paragraphs.push(current);
      current = [block];
      windowStart = block.createdAt;
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?\u3002\uFF01\uFF1F]\s*$/, "");
}

function joinTexts(
  paragraph: readonly TranscriptBlock[],
  getText: (b: TranscriptBlock) => string | undefined
): string {
  return paragraph
    .map((b, i) => {
      const text = getText(b) ?? "";
      if (!text) return "";
      const isLast = i === paragraph.length - 1;
      return b.partial && !isLast ? stripTrailingPunctuation(text) : text;
    })
    .filter(Boolean)
    .join(" ");
}

function Paragraph({ blocks, isLast, canTranslate }: { blocks: TranscriptBlock[]; isLast: boolean; canTranslate: boolean }) {
  const first = blocks[0];
  const isTranscriptionOnly = first.sourceLabel === first.targetLabel;
  const isNonEnglishSource = first.sourceLabel !== "EN";

  const sourceText = joinTexts(blocks, (b) => b.sourceText);
  const translationText = joinTexts(blocks, (b) => b.translation);
  const hasPending = canTranslate && blocks.some((b) => !b.translation);

  return (
    <div className={`pb-3 ${isLast ? "" : "mb-3 border-b border-border/50"}`}>
      <div className="font-mono text-muted-foreground text-[11px] mb-1 flex items-center gap-1.5">
        {first.audioSource === "microphone" ? (
          <MicIcon className="size-3 text-mic-source" />
        ) : (
          <Volume2Icon className="size-3 text-system-source" />
        )}
        {formatTimestamp(first.createdAt)}
      </div>
      <div className="text-sm font-mono">
        <span className="text-foreground">{sourceText}</span>
        {isNonEnglishSource && (
          <span className="text-[11px] text-muted-foreground/60 ml-1.5 font-mono">
            {first.sourceLabel.toLowerCase()}
          </span>
        )}
      </div>
      {!isTranscriptionOnly && canTranslate && (
        <div className="text-sm font-sans mt-0.5">
          {translationText ? (
            <span className="text-foreground">
              {translationText}
              {hasPending && (
                <span className="text-muted-foreground ml-1 animate-pulse">
                  Translating...
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground animate-pulse">
              Translating...
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const TranscriptArea = forwardRef<HTMLDivElement, TranscriptAreaProps>(
  function TranscriptArea({ blocks, systemPartial, micPartial, canTranslate, onCreateTodoFromSelection }, ref) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectionMenuRef = useRef<HTMLDivElement>(null);
    const selectionMenuTimerRef = useRef<number | null>(null);
    const paragraphs = useMemo(() => groupIntoParagraphs(blocks), [blocks]);
    const [selectionText, setSelectionText] = useState("");
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [submittingSelection, setSubmittingSelection] = useState(false);
    const [selectionFeedback, setSelectionFeedback] = useState("");
    const [todoIntentInput, setTodoIntentInput] = useState("");

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [blocks.length]);

    const setContainerRef = useCallback((node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    }, [ref]);

    const clearSelectionMenuTimer = useCallback(() => {
      if (selectionMenuTimerRef.current == null) return;
      window.clearTimeout(selectionMenuTimerRef.current);
      selectionMenuTimerRef.current = null;
    }, []);

    const clearSelectionMenu = useCallback((clearNativeSelection = false) => {
      clearSelectionMenuTimer();
      setSelectionText("");
      setMenuPosition(null);
      setSubmittingSelection(false);
      setSelectionFeedback("");
      setTodoIntentInput("");
      if (!clearNativeSelection) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }
    }, [clearSelectionMenuTimer]);

    const handleSelectionChange = useCallback((event?: SyntheticEvent) => {
      if (!onCreateTodoFromSelection) return;
      if (
        selectionMenuRef.current
        && event?.target instanceof Node
        && selectionMenuRef.current.contains(event.target)
      ) {
        return;
      }
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        clearSelectionMenu();
        return;
      }

      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const anchorElement = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      const isInsideTranscript = !!anchorElement && container.contains(anchorElement);
      if (!isInsideTranscript) {
        clearSelectionMenu();
        return;
      }

      const selected = selection.toString().trim();
      if (!selected) {
        clearSelectionMenu();
        return;
      }

      const rangeRect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const minLeft = container.scrollLeft + 8;
      const maxLeft = container.scrollLeft + container.clientWidth - 130;
      let left = rangeRect.left - containerRect.left + container.scrollLeft;
      left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));

      let top = rangeRect.top - containerRect.top + container.scrollTop - 34;
      if (top < container.scrollTop + 4) {
        top = rangeRect.bottom - containerRect.top + container.scrollTop + 6;
      }

      setSelectionText(selected);
      setMenuPosition({ top, left });
      setSelectionFeedback("");
    }, [clearSelectionMenu, onCreateTodoFromSelection]);

    const handleMouseSelectionChange = useCallback(() => {
      clearSelectionMenuTimer();
      selectionMenuTimerRef.current = window.setTimeout(() => {
        selectionMenuTimerRef.current = null;
        handleSelectionChange();
      }, SELECTION_MENU_DEBOUNCE_MS);
    }, [clearSelectionMenuTimer, handleSelectionChange]);

    const handleCreateTodo = useCallback(async () => {
      if (!onCreateTodoFromSelection || !selectionText.trim() || submittingSelection) return;
      setSubmittingSelection(true);
      setSelectionFeedback("");
      const result = await onCreateTodoFromSelection(selectionText, todoIntentInput.trim() || undefined);
      if (result.ok) {
        clearSelectionMenu(true);
        return;
      }
      setSubmittingSelection(false);
      setSelectionFeedback(result.message || "Could not create todo from selection.");
    }, [
      clearSelectionMenu,
      onCreateTodoFromSelection,
      selectionText,
      submittingSelection,
      todoIntentInput,
    ]);

    useEffect(() => {
      if (!menuPosition) return;
      const closeOnOutsidePointer = (event: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;
        if (event.target instanceof Node && container.contains(event.target)) return;
        clearSelectionMenu();
      };
      document.addEventListener("mousedown", closeOnOutsidePointer);
      return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
    }, [clearSelectionMenu, menuPosition]);

    useEffect(() => () => {
      clearSelectionMenuTimer();
    }, [clearSelectionMenuTimer]);

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-4 pt-2.5 pb-1.5 shrink-0">
          Live Transcript
        </h2>
        <div
          ref={setContainerRef}
          className="relative flex-1 overflow-y-auto px-4 pb-2"
          onMouseUp={handleMouseSelectionChange}
          onKeyUp={handleSelectionChange}
          onTouchEnd={handleSelectionChange}
          onScroll={() => {
            if (menuPosition) clearSelectionMenu();
          }}
        >
          {menuPosition && onCreateTodoFromSelection && (
            <div
              className="absolute z-20"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <div
                ref={selectionMenuRef}
                className="w-64 rounded-none border border-border bg-background px-1 py-1 shadow-sm"
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onTouchEnd={(event) => event.stopPropagation()}
                onKeyUp={(event) => event.stopPropagation()}
              >
                <Input
                  value={todoIntentInput}
                  onChange={(event) => setTodoIntentInput(event.target.value)}
                  placeholder="Optional: what todo should this create?"
                  className="h-7 text-xs"
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreateTodo();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="mt-1 h-6 w-full px-2 text-[11px]"
                  disabled={submittingSelection}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { void handleCreateTodo(); }}
                >
                  {submittingSelection ? (
                    <LoaderCircleIcon className="size-3 animate-spin" />
                  ) : (
                    "Create todo"
                  )}
                </Button>
                {selectionFeedback && (
                  <p className="px-1 pt-1 text-[11px] text-muted-foreground max-w-56">
                    {selectionFeedback}
                  </p>
                )}
              </div>
            </div>
          )}
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic mt-2">
              Speak to see transcriptions here...
            </p>
          ) : (
            paragraphs.map((para, i) => (
              <Paragraph
                key={para[0].id}
                blocks={para}
                isLast={i === paragraphs.length - 1}
                canTranslate={canTranslate ?? false}
              />
            ))
          )}
          {systemPartial && (
            <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground/50 italic animate-pulse">
              <Volume2Icon className="size-3 shrink-0" />
              <span>{systemPartial}</span>
            </div>
          )}
          {micPartial && (
            <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground/50 italic animate-pulse">
              <MicIcon className="size-3 shrink-0" />
              <span>{micPartial}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    );
  }
);
