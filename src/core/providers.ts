import type { LanguageModel } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { SessionConfig } from "./types";

export function createTranscriptionModel(config: SessionConfig): LanguageModel {
  switch (config.transcriptionProvider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey:
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
          process.env.GEMINI_API_KEY,
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
      throw new Error(
        "ElevenLabs transcription does not use an AI SDK language model."
      );
    }
    case "whisper": {
      throw new Error("Whisper runs locally and does not use an AI SDK model.");
    }
  }
  throw new Error(
    `Unsupported transcription provider: ${String(config.transcriptionProvider)}`
  );
}

export function createAnalysisModel(config: SessionConfig): LanguageModel {
  switch (config.analysisProvider) {
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      const provider = {
        sort: "throughput" as const,
        ...(config.analysisProviderOnly ? { only: [config.analysisProviderOnly] } : {}),
      };
      return openrouter(config.analysisModelId, {
        reasoning: config.analysisReasoning ? { max_tokens: 4096, exclude: false } : undefined,
        provider,
      });
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey:
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
          process.env.GEMINI_API_KEY,
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
  throw new Error(
    `Unsupported analysis provider: ${String(config.analysisProvider)}`
  );
}

export function createTodoModel(config: SessionConfig): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const provider = {
    sort: "throughput" as const,
    ...(config.todoProviders?.length ? { only: config.todoProviders } : {}),
  };
  return openrouter(config.todoModelId, {
    reasoning: { max_tokens: 1024, exclude: false },
    provider,
  });
}
