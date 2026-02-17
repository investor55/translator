import type { LanguageModel } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { SessionConfig } from "./types";

function getOpenRouterProviderSort():
  | "price"
  | "throughput"
  | "latency"
  | undefined {
  const raw = process.env.OPENROUTER_PROVIDER_SORT?.trim().toLowerCase();
  if (raw === "price" || raw === "throughput" || raw === "latency") {
    return raw;
  }
  return undefined;
}

function getOpenRouterTodoProviderSort():
  | "price"
  | "throughput"
  | "latency"
  | undefined {
  const raw = process.env.OPENROUTER_TODO_PROVIDER_SORT?.trim().toLowerCase();
  if (raw === "price" || raw === "throughput" || raw === "latency") {
    return raw;
  }
  return "latency";
}

export function createTranscriptionModel(config: SessionConfig): LanguageModel {
  switch (config.transcriptionProvider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY,
      });
      return google(config.transcriptionModelId);
    }
    case "vertex": {
      const vertex = createVertex({
        project: config.vertexProject,
        location: config.vertexLocation,
      });
      return vertex(config.transcriptionModelId);
    }
    case "elevenlabs": {
      throw new Error("ElevenLabs transcription does not use an AI SDK language model.");
    }
  }
  throw new Error(`Unsupported transcription provider: ${String(config.transcriptionProvider)}`);
}

export function createAnalysisModel(config: SessionConfig): LanguageModel {
  switch (config.analysisProvider) {
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      const providerSort = getOpenRouterProviderSort();
      return openrouter(config.analysisModelId, {
        reasoning: { max_tokens: 4096, exclude: false },
        provider: providerSort ? { sort: providerSort } : undefined,
      });
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY,
      });
      return google(config.analysisModelId);
    }
    case "vertex": {
      const vertex = createVertex({
        project: config.vertexProject,
        location: config.vertexLocation,
      });
      return vertex(config.analysisModelId);
    }
  }
  throw new Error(`Unsupported analysis provider: ${String(config.analysisProvider)}`);
}

export function createTodoModel(config: SessionConfig): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const providerSort = getOpenRouterTodoProviderSort();
  const todoModelId = config.todoModelId ?? process.env.TODO_MODEL_ID ?? "openai/gpt-oss-120b";
  return openrouter(todoModelId, {
    reasoning: { max_tokens: 0, exclude: true },
    provider: providerSort ? { sort: providerSort } : undefined,
  });
}
