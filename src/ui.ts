export type TranscriptBlock = {
  id: number;
  sourceLabel: "KR" | "EN";
  sourceText: string;
  targetLabel: "KR" | "EN";
  translation?: string;
  createdAt: number;
};
