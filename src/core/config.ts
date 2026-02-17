import type { AnalysisProvider, SessionConfig, TranscriptionProvider } from "./types";

export function validateEnv(config: Pick<SessionConfig, "transcriptionProvider" | "analysisProvider" | "vertexProject" | "vertexLocation">) {
  const missing: string[] = [];

  const needsVertex = config.transcriptionProvider === "vertex" || config.analysisProvider === "vertex";
  const needsGoogle = config.transcriptionProvider === "google" || config.analysisProvider === "google";
  const needsOpenRouter = config.analysisProvider === "openrouter";

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

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}
