import type { SessionConfig } from "./types";

export function validateEnv(config: Pick<SessionConfig, "transcriptionProvider" | "analysisProvider" | "vertexProject" | "vertexLocation">) {
  const missing: string[] = [];

  const needsVertex = config.transcriptionProvider === "vertex" || config.analysisProvider === "vertex";
  const needsGoogle = config.transcriptionProvider === "google" || config.analysisProvider === "google";
  const needsOpenRouter = config.transcriptionProvider === "openrouter" || config.analysisProvider === "openrouter";
  const needsElevenLabs = config.transcriptionProvider === "elevenlabs";

  if (needsVertex) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      missing.push("GOOGLE_APPLICATION_CREDENTIALS");
    }
    if (!process.env.GOOGLE_VERTEX_PROJECT_ID && !config.vertexProject) {
      missing.push("GOOGLE_VERTEX_PROJECT_ID");
    }
  }

  if (needsGoogle) {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GEMINI_API_KEY) {
      missing.push("GOOGLE_GENERATIVE_AI_API_KEY");
    }
  }

  if (needsOpenRouter) {
    if (!process.env.OPENROUTER_API_KEY) {
      missing.push("OPENROUTER_API_KEY");
    }
  }

  if (needsElevenLabs) {
    if (!process.env.ELEVENLABS_API_KEY) {
      missing.push("ELEVENLABS_API_KEY");
    }
  }

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}
