import { forwardRef, useEffect, useRef, useMemo } from "react";
import type { TranscriptBlock } from "../../../core/types";

type TranscriptAreaProps = {
  blocks: TranscriptBlock[];
};

const PARAGRAPH_MAX_MS = 30_000;

const LABEL_COLORS: Record<string, string> = {};
const COLOR_CLASSES = [
  "text-green-400",
  "text-cyan-400",
  "text-yellow-400",
  "text-fuchsia-400",
  "text-blue-400",
];
let nextColorIdx = 0;

function getColorClass(label: string): string {
  if (!LABEL_COLORS[label]) {
    LABEL_COLORS[label] = COLOR_CLASSES[nextColorIdx % COLOR_CLASSES.length];
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

function Paragraph({ blocks }: { blocks: TranscriptBlock[] }) {
  const first = blocks[0];
  const sourceColor = getColorClass(first.sourceLabel);
  const targetColor = getColorClass(first.targetLabel);
  const isTranscriptionOnly = first.sourceLabel === first.targetLabel;

  const sourceText = joinTexts(blocks, (b) => b.sourceText);
  const translationText = joinTexts(blocks, (b) => b.translation);
  const hasPending = blocks.some((b) => !b.translation);

  return (
    <div className="mb-3">
      <div className="text-xs text-slate-500 mb-0.5">
        {"\u2014"} {formatTimestamp(first.createdAt)} {"\u2014"}
      </div>
      <div className="text-sm">
        <span className={`font-semibold ${sourceColor}`}>
          {first.sourceLabel}:
        </span>{" "}
        <span className="text-slate-200">{sourceText}</span>
      </div>
      {!isTranscriptionOnly && (
        <div className="text-sm">
          <span className={`font-semibold ${targetColor}`}>
            {first.targetLabel}:
          </span>{" "}
          {translationText ? (
            <span className="text-slate-200">
              {translationText}
              {hasPending && (
                <span className="text-slate-500 ml-1">Processing...</span>
              )}
            </span>
          ) : (
            <span className="text-slate-500">Processing...</span>
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
      <div className="flex-1 flex flex-col min-h-0 border-b border-slate-700">
        <h2 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider px-4 pt-2 pb-1 shrink-0">
          Live Transcript
        </h2>
        <div ref={ref} className="flex-1 overflow-y-auto px-4 pb-2">
          {blocks.length === 0 ? (
            <p className="text-sm text-slate-500 italic mt-2">
              Speak to see transcriptions here...
            </p>
          ) : (
            paragraphs.map((para, i) => (
              <Paragraph key={para[0].id} blocks={para} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    );
  }
);
