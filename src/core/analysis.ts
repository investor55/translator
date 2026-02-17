import { z } from "zod";
import type { TranscriptBlock, TodoItem } from "./types";

export const analysisSchema = z.object({
  keyPoints: z
    .array(z.string())
    .describe("2-4 key points from the recent conversation. Each must be a specific, verifiable fact. One sentence each."),
  educationalInsights: z
    .array(
      z.object({
        text: z.string().describe("A concise educational note providing background knowledge about a topic mentioned in the conversation"),
        kind: z
          .enum(["definition", "context", "fact", "tip"])
          .describe("definition = explains a term or concept; context = provides relevant background; fact = interesting related fact; tip = practical advice related to the topic"),
      })
    )
    .describe("1-3 educational notes that help the listener understand topics mentioned in the conversation. Think of these as helpful footnotes."),
  suggestedTodos: z
    .array(z.string())
    .describe("Action items or tasks mentioned in the conversation. Include anything that sounds like something someone wants to do, needs to do, or should follow up on. Be liberal — it's better to suggest a todo that gets dismissed than to miss one."),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;

export function buildAnalysisPrompt(
  recentBlocks: TranscriptBlock[],
  existingTodos: ReadonlyArray<Pick<TodoItem, "text" | "completed">>,
  previousKeyPoints: readonly string[]
): string {
  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  const todosSection =
    existingTodos.length > 0
      ? `\n\nExisting todos:\n${existingTodos.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";

  const keyPointsSection =
    previousKeyPoints.length > 0
      ? `\n\nPrevious key points from this session:\n${previousKeyPoints.map((p) => `- ${p}`).join("\n")}`
      : "";

  return `You are a knowledgeable assistant listening to a conversation. Your job is to provide helpful background knowledge about topics being discussed — like an intelligent footnote system.

Recent transcript:
${transcript}${todosSection}${keyPointsSection}

Tasks:

1. KEY POINTS (2-4): Extract the main facts from the conversation. Be specific — names, numbers, dates.

2. EDUCATIONAL INSIGHTS (1-3): Provide supplementary knowledge that helps the listener understand what's being discussed. These should NOT summarize the conversation — they should TEACH the listener something new.

Examples of good educational insights:
- If they mention "Kubernetes": "Kubernetes (K8s) is an open-source container orchestration platform originally developed by Google, now maintained by the CNCF."
- If they discuss a Korean cultural practice: "설날 (Seollal) is the Korean Lunar New Year, one of the most important traditional holidays, typically celebrated with 떡국 (rice cake soup)."
- If they reference a business metric: "Customer Acquisition Cost (CAC) is calculated by dividing total sales and marketing spend by the number of new customers acquired in that period."
- If they mention a place: "Gangnam district in Seoul became internationally known after PSY's 2012 hit, but is primarily Korea's financial and tech hub, home to COEX and the Korea World Trade Center."

Bad examples (do NOT do these):
- "The speakers discussed Kubernetes" (this is a summary, not educational)
- "The conversation covered several topics" (this is filler)
- "They seemed interested in the subject" (this is commentary)

Each insight should be something the listener could look up on Wikipedia — a definition, a fact, a piece of context that enriches understanding.

3. SUGGESTED TODOS: Extract any tasks, action items, or things to follow up on. Be aggressive — catch anything that sounds like a todo.
- Triggers: "add a todo", "I need to", "we should", "let's", "remind me to", "don't forget", "I want to", "we have to", "gotta", "should check", "look into", "find out", any question implying research ("where is the best...?", "what's a good...?")
- CRITICAL: Preserve ALL specific details — names, places, times, conditions, constraints. Read the ENTIRE transcript to gather the full context before writing the todo.
  - BAD: "Find information for Victoria Drive" (too vague, lost the time constraint)
  - GOOD: "Find places on Victoria Drive still open at 8 PM" (preserves location + time)
  - BAD: "Look into restaurants" (missing specifics)
  - GOOD: "Find a pho restaurant in Vancouver open past 9 PM" (preserves cuisine + city + time)
- Combine related fragments: if someone says "add a todo" in one sentence and specifies details across the next few sentences, merge them into ONE complete todo
- Do NOT duplicate existing todos
- Empty array ONLY if truly nothing actionable was discussed`;
}
