import fs from "node:fs";
import path from "node:path";

const SUMMARY_PROMPT_PATH = path.join("prompts", "summary", "system.md");
const INSIGHTS_PROMPT_PATH = path.join("prompts", "insights", "system.md");
const ANALYSIS_REQUEST_PROMPT_PATH = path.join("prompts", "analysis", "request.md");
const TODO_EXTRACT_PROMPT_PATH = path.join("prompts", "todo", "extract.md");
const TODO_FROM_SELECTION_PROMPT_PATH = path.join("prompts", "todo", "from-selection.md");
const TODO_SIZE_CLASSIFIER_PROMPT_PATH = path.join("prompts", "todo", "size-classifier.md");
const AGENT_SYSTEM_PROMPT_PATH = path.join("prompts", "agent", "system.md");
const AGENT_INITIAL_USER_PROMPT_PATH = path.join("prompts", "agent", "initial-user.md");
const AUDIO_AUTO_PROMPT_PATH = path.join("prompts", "transcription", "audio-auto.md");
const AUDIO_SOURCE_TARGET_PROMPT_PATH = path.join("prompts", "transcription", "audio-source-target.md");
const TRANSCRIPT_POST_PROCESS_PROMPT_PATH = path.join("prompts", "transcription", "post-process.md");
const PARAGRAPH_DECISION_PROMPT_PATH = path.join("prompts", "transcription", "paragraph-decision.md");

const DEFAULT_SUMMARY_SYSTEM_PROMPT = `You produce concise conversation key points for a live transcript.

Task:
- Return 2-4 key points as specific, verifiable facts from the current conversation window.

Rules:
- Prioritize concrete details: names, places, dates, numbers, decisions, constraints.
- One sentence per key point.
- Do not include filler like "they discussed several topics."
- Keep points tightly tied to what was actually said.`;

const DEFAULT_INSIGHTS_SYSTEM_PROMPT = `You generate educational insights that help explain topics mentioned in the transcript.

Task:
- Return 1-3 short educational insights.

Rules:
- Each insight must be directly related to entities or concepts explicitly mentioned.
- Insights must teach context, definitions, facts, or practical tips.
- Do not summarize the conversation.
- Do not speculate or invent unsupported claims.
- If no meaningful topic is present, return an empty insights list.

Good examples:
- If they mention "Kubernetes": "Kubernetes is an open-source container orchestration platform originally developed at Google and now governed by CNCF."
- If they mention "CAC": "Customer Acquisition Cost (CAC) is total sales and marketing spend divided by the number of newly acquired customers."

Bad examples:
- "They discussed Kubernetes." (summary, not educational)
- "The conversation covered many topics." (filler)`;

const DEFAULT_ANALYSIS_REQUEST_PROMPT = `{{summary_system_prompt}}

{{insights_system_prompt}}

Recent transcript:
{{transcript}}{{previous_key_points_section}}

Grounding requirements:
- Use only information from the transcript and previous key points from THIS session.
- Do not use memory from prior sessions.
- If transcript details are sparse, return fewer items rather than inventing details.`;

const DEFAULT_TODO_EXTRACT_PROMPT = `You extract TODOs from live conversation transcripts.

Recent transcript:
{{transcript}}{{existing_todos_section}}

Task:
- Extract only clear tasks, action items, or follow-ups.
- Suggest todos when there is explicit intent, commitment, or concrete planning (for example: "I need to", "we should", "add a todo", "remind me to", "don't forget to", "I'm planning to", "I'm going to", "I'm looking to", "I want to", "I wanna").
- Treat first-person planning statements as actionable TODOs even when dates are not fixed yet.
- Treat travel planning and scheduling intent as TODOs (for example: "I'm planning to visit X", "we should decide where else to go", "need to book X").
- Skip vague brainstorming and informational statements without a clear next action.
- Ignore bracketed non-speech tags like [silence], [music], [noise], [laughs].
- Preserve details exactly: names, places, dates, times, constraints.
- Merge fragments across neighboring lines into one complete todo.
- For each todo, return:
  - todoTitle: short imperative action phrase.
  - todoDetails: rich context and constraints needed by an autonomous agent, including background, assumptions, boundaries, and success criteria.
  - transcriptExcerpt: short verbatim excerpt from the transcript that grounds the todo.
- Do NOT duplicate existing todos.
- Return an empty list when no clear actionable todo was discussed.`;

const DEFAULT_TODO_FROM_SELECTION_PROMPT = `You convert highlighted transcript text into one concrete TODO.

Highlighted transcript:
{{selected_text}}{{user_intent_section}}{{existing_todos_section}}

Task:
- Treat the highlighted transcript as grounding context.
- If user intent is provided, prioritize it and convert it into one short imperative todo that is consistent with context.
- If no user intent is provided, decide whether the highlighted text contains a clear actionable commitment, follow-up, or planning intent.
- Return both:
  - todoTitle: concise action title.
  - todoDetails: rich context and constraints needed by an autonomous agent, including relevant background, assumptions, scope boundaries, and success criteria.
- Preserve critical details (names, places, dates, constraints).
- Do not create a todo when the text is unclear, conversational filler, or non-actionable.
- Do not duplicate an existing todo.
- Return empty todoTitle and todoDetails when shouldCreateTodo is false.`;

const DEFAULT_TODO_SIZE_CLASSIFIER_PROMPT = `Classify this todo for autonomous execution risk.

Todo:
{{todo_text}}

Rules:
- small: single, low-risk, straightforward action that can be run automatically.
- large: multi-step, ambiguous, high-impact, risky, or likely to need human judgment.
- Prefer large when uncertain.
- Confidence must be between 0 and 1.
- Reason must be concise (one short sentence).`;

const DEFAULT_AGENT_SYSTEM_PROMPT = `You are a practical research assistant.

Today is {{today}}.

Conversation context from the current session:
{{transcript_context}}

Instructions:
- If the task is ambiguous, under-specified, or has multiple plausible interpretations, call askQuestion before researching or answering.
- Prefer asking 1-3 focused multiple-choice clarification questions.
- In askQuestion options, provide concrete suggested paths and mark the best default with "(Recommended)" when appropriate.
- Use searchWeb only when external facts are required (especially if the user asks for latest/current/today/recent information). Do not search for simple reasoning or writing tasks.
- For time-sensitive information, verify with search and include concrete dates in the final answer.
- Use getTranscriptContext when you need more local conversation context.
- Keep the final answer concise and actionable.

MCP integrations (Notion, Linear, and others):
- To use any integration tool, first call searchMcpTools with relevant keywords (e.g. "create page", "list issues", "search database").
- Review the returned tool names, descriptions, and inputSchema, then call callMcpTool with the correct name and args.
- Never guess tool names. Always search first.`;

const DEFAULT_AGENT_INITIAL_USER_PROMPT = `Todo:
{{todo}}
{{context_section}}`;

const DEFAULT_AUDIO_AUTO_PROMPT = `{{summary_block}}{{context_block}}Listen to the audio clip. The speaker may be speaking {{lang_list}}. The speaker may occasionally use English words or phrases even when primarily speaking another language - treat code-switching as part of the primary language, not as a language change.
1. Detect the primary spoken language ({{code_list}})
2. Transcribe the audio in its original language
3. {{translate_rule}}

IMPORTANT: The transcript field must be in the detected source language. The translation field must ALWAYS be in a DIFFERENT language than the transcript. If you hear {{source_lang_name}}, the translation must be {{target_lang_name}}, not {{source_lang_name}}.
IMPORTANT: Never translate or paraphrase the transcript into English. Keep transcript in the spoken language exactly as heard.

You are a strict transcriber. Output ONLY the exact words spoken - never add, infer, or complete words or sentences beyond what is audible.

If the audio is cut off mid-sentence, transcribe only what was actually spoken. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.

Return sourceLanguage ({{code_list}}), transcript, isPartial, and translation.`;

const DEFAULT_AUDIO_SOURCE_TARGET_PROMPT = `{{summary_block}}{{context_block}}Listen to the audio clip spoken in {{source_lang_name}}. Transcribe it in {{source_lang_name}} and translate it into {{target_lang_name}}.{{english_note}}

IMPORTANT: The translation MUST be in {{target_lang_name}}. Never return a translation in the same language as the transcript.
IMPORTANT: Transcript must stay in {{source_lang_name}}. Do not translate transcript into English.

You are a strict transcriber. Output ONLY the exact words spoken - never add, infer, or complete words or sentences beyond what is audible.

If the audio is cut off mid-sentence, transcribe only what was actually spoken. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.`;

const DEFAULT_TRANSCRIPT_POST_PROCESS_PROMPT = `{{summary_block}}{{context_block}}You are post-processing a speech transcript from a dedicated STT model.
Do not rewrite the transcript text.

Transcript:
"""{{transcript}}"""

Detected language hint: "{{detected_lang_hint}}"
{{translation_rule}}

Return:
1) sourceLanguage
2) translation
3) isPartial
4) isNewTopic`;

const DEFAULT_PARAGRAPH_DECISION_PROMPT = `You decide whether a live transcript should be committed as a paragraph now.
Commit when:
- A complete thought has ended (natural sentence boundary or clear pause).
- The text reads as a coherent paragraph segment.

Do not commit when:
- The speaker is clearly mid-thought.
- The ending looks cut off.

Transcript:
"""{{transcript}}"""`;

function loadPrompt(relativePath: string, fallback: string): string {
  const fullPath = path.join(process.cwd(), relativePath);
  try {
    if (!fs.existsSync(fullPath)) return fallback;
    const content = fs.readFileSync(fullPath, "utf-8").trim();
    return content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, string | number | boolean | null | undefined>,
): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{{${key}}}`;
    output = output.split(placeholder).join(value == null ? "" : String(value));
  }
  return output;
}

export function getSummarySystemPrompt(): string {
  return loadPrompt(SUMMARY_PROMPT_PATH, DEFAULT_SUMMARY_SYSTEM_PROMPT);
}

export function getInsightsSystemPrompt(): string {
  return loadPrompt(INSIGHTS_PROMPT_PATH, DEFAULT_INSIGHTS_SYSTEM_PROMPT);
}

export function getAnalysisRequestPromptTemplate(): string {
  return loadPrompt(ANALYSIS_REQUEST_PROMPT_PATH, DEFAULT_ANALYSIS_REQUEST_PROMPT);
}

export function getTodoExtractPromptTemplate(): string {
  return loadPrompt(TODO_EXTRACT_PROMPT_PATH, DEFAULT_TODO_EXTRACT_PROMPT);
}

export function getTodoFromSelectionPromptTemplate(): string {
  return loadPrompt(TODO_FROM_SELECTION_PROMPT_PATH, DEFAULT_TODO_FROM_SELECTION_PROMPT);
}

export function getTodoSizeClassifierPromptTemplate(): string {
  return loadPrompt(TODO_SIZE_CLASSIFIER_PROMPT_PATH, DEFAULT_TODO_SIZE_CLASSIFIER_PROMPT);
}

export function getAgentSystemPromptTemplate(): string {
  return loadPrompt(AGENT_SYSTEM_PROMPT_PATH, DEFAULT_AGENT_SYSTEM_PROMPT);
}

export function getAgentInitialUserPromptTemplate(): string {
  return loadPrompt(AGENT_INITIAL_USER_PROMPT_PATH, DEFAULT_AGENT_INITIAL_USER_PROMPT);
}

export function getAudioAutoPromptTemplate(): string {
  return loadPrompt(AUDIO_AUTO_PROMPT_PATH, DEFAULT_AUDIO_AUTO_PROMPT);
}

export function getAudioSourceTargetPromptTemplate(): string {
  return loadPrompt(AUDIO_SOURCE_TARGET_PROMPT_PATH, DEFAULT_AUDIO_SOURCE_TARGET_PROMPT);
}

export function getTranscriptPostProcessPromptTemplate(): string {
  return loadPrompt(TRANSCRIPT_POST_PROCESS_PROMPT_PATH, DEFAULT_TRANSCRIPT_POST_PROCESS_PROMPT);
}

export function getParagraphDecisionPromptTemplate(): string {
  return loadPrompt(PARAGRAPH_DECISION_PROMPT_PATH, DEFAULT_PARAGRAPH_DECISION_PROMPT);
}
