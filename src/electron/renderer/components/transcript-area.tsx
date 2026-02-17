import { forwardRef, useEffect, useRef, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TranscriptBlock } from "../../../core/types";

type TranscriptAreaProps = {
  blocks: TranscriptBlock[];
};

const PARAGRAPH_MAX_MS = 30_000;

const LABEL_COLORS: Record<string, string> = {};
const SPEAKER_CLASSES = [
  "text-speaker-1",
  "text-speaker-2",
  "text-speaker-3",
  "text-speaker-4",
  "text-speaker-5",
];
let nextColorIdx = 0;

function getSpeakerColor(label: string): string {
  if (!LABEL_COLORS[label]) {
    LABEL_COLORS[label] = SPEAKER_CLASSES[nextColorIdx % SPEAKER_CLASSES.length];
    nextColorIdx++;
  }
  return LABEL_COLORS[label];
}

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

    if (block.newTopic || block.createdAt - windowStart > PARAGRAPH_MAX_MS) {
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

function Paragraph({ blocks, isLast }: { blocks: TranscriptBlock[]; isLast: boolean }) {
  const first = blocks[0];
  const sourceColor = getSpeakerColor(first.sourceLabel);
  const targetColor = getSpeakerColor(first.targetLabel);
  const isTranscriptionOnly = first.sourceLabel === first.targetLabel;

  const sourceText = joinTexts(blocks, (b) => b.sourceText);
  const translationText = joinTexts(blocks, (b) => b.translation);
  const hasPending = blocks.some((b) => !b.translation);

  return (
    <div className={`pb-3 ${isLast ? "" : "mb-3 border-b border-border/50"}`}>
      <div className="font-mono text-muted-foreground text-[11px] mb-1">
        {formatTimestamp(first.createdAt)}
      </div>
      <div className="text-sm font-mono">
        <span className={`font-semibold ${sourceColor}`}>
          {first.sourceLabel}:
        </span>{" "}
        <span className="text-foreground">{sourceText}</span>
      </div>
      {!isTranscriptionOnly && (
        <div className="text-sm font-sans mt-0.5">
          <span className={`font-semibold ${targetColor}`}>
            {first.targetLabel}:
          </span>{" "}
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
  function TranscriptArea({ blocks }, ref) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const paragraphs = useMemo(() => groupIntoParagraphs(blocks), [blocks]);

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [blocks.length]);

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1 shrink-0">
          Live Transcript
        </h2>
        <div ref={ref} className="flex-1 overflow-y-auto px-4 pb-2">
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
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    );
  }
);
