import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { TaskSize } from "../types";
import { toReadableError } from "../text/text-utils";
import { getTaskSizeClassifierPromptTemplate, renderPromptTemplate } from "../prompt-loader";

const TASK_SIZE_TIMEOUT_MS = 12_000;
const DEFAULT_MIN_CONFIDENCE = 0.65;

export const taskSizeClassificationSchema = z.object({
  size: z.enum(["small", "large"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(160),
});

export type TaskSizeClassification = z.infer<typeof taskSizeClassificationSchema>;

function defaultClassification(reason: string): TaskSizeClassification {
  return {
    size: "large",
    confidence: 0,
    reason,
  };
}

function normalizeReason(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : "No reason provided";
}

function buildTaskSizePrompt(text: string): string {
  return renderPromptTemplate(getTaskSizeClassifierPromptTemplate(), {
    task_text: text,
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Task size classification timed out")), timeoutMs);
    void promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isValidSize(value: string): value is TaskSize {
  return value === "small" || value === "large";
}

export async function classifyTaskSize(
  model: LanguageModel,
  text: string,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
): Promise<TaskSizeClassification> {
  const trimmed = text.trim();
  if (!trimmed) {
    return defaultClassification("Empty task text");
  }

  try {
    const { object } = await withTimeout(
      generateObject({
        model,
        schema: taskSizeClassificationSchema,
        prompt: buildTaskSizePrompt(trimmed),
      }),
      TASK_SIZE_TIMEOUT_MS,
    );

    if (!isValidSize(object.size)) {
      return defaultClassification("Invalid size from classifier");
    }

    if (!Number.isFinite(object.confidence) || object.confidence < minConfidence) {
      return defaultClassification(
        `Low classifier confidence (${Number.isFinite(object.confidence) ? object.confidence.toFixed(2) : "NaN"})`,
      );
    }

    return {
      size: object.size,
      confidence: object.confidence,
      reason: normalizeReason(object.reason),
    };
  } catch (error) {
    return defaultClassification(`Classifier error: ${toReadableError(error)}`);
  }
}
