export type TranscriptBlock = {
  id: number;
  sourceLabel: string; // ISO 639-1 code uppercased (e.g., "EN", "KO", "JA")
  sourceText: string;
  targetLabel: string; // Always "EN" for translation target
  translation?: string;
  partial?: boolean; // true if transcript was cut off mid-sentence
  createdAt: number;
};
