import { isAudioSilent } from "./audio-utils";

const VAD_WINDOW_MS = 100;
const VAD_WINDOW_BYTES = Math.floor(16000 * 2 * (VAD_WINDOW_MS / 1000)); // 3200 bytes
const VAD_SILENCE_FLUSH_MS = 400;
const VAD_MAX_CHUNK_MS = 4000;
const VAD_MIN_CHUNK_MS = 500;

export type VadState = {
  analysisBuffer: Buffer;
  speechBuffer: Buffer;
  silenceMs: number;
  speechStarted: boolean;
};

export function createVadState(): VadState {
  return {
    analysisBuffer: Buffer.alloc(0),
    speechBuffer: Buffer.alloc(0),
    silenceMs: 0,
    speechStarted: false,
  };
}

export function resetVadState(state: VadState) {
  state.analysisBuffer = Buffer.alloc(0);
  state.speechBuffer = Buffer.alloc(0);
  state.silenceMs = 0;
  state.speechStarted = false;
}

// Returns an array of speech chunks ready to be sent for transcription
export function processAudioData(state: VadState, data: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  state.analysisBuffer = Buffer.concat([state.analysisBuffer, data]);

  while (state.analysisBuffer.length >= VAD_WINDOW_BYTES) {
    const window = state.analysisBuffer.subarray(0, VAD_WINDOW_BYTES);
    state.analysisBuffer = state.analysisBuffer.subarray(VAD_WINDOW_BYTES);
    const silent = isAudioSilent(window);

    if (silent) {
      if (state.speechStarted) {
        state.speechBuffer = Buffer.concat([state.speechBuffer, window]);
        state.silenceMs += VAD_WINDOW_MS;
        if (state.silenceMs >= VAD_SILENCE_FLUSH_MS) {
          const flushed = flushVad(state);
          if (flushed) chunks.push(flushed);
        }
      }
    } else {
      state.speechBuffer = Buffer.concat([state.speechBuffer, window]);
      state.speechStarted = true;
      state.silenceMs = 0;

      const speechDurationMs = (state.speechBuffer.length / (16000 * 2)) * 1000;
      if (speechDurationMs >= VAD_MAX_CHUNK_MS) {
        const flushed = flushVad(state);
        if (flushed) chunks.push(flushed);
      }
    }
  }

  return chunks;
}

// Force-flush any remaining speech buffer
export function flushVad(state: VadState): Buffer | null {
  if (state.speechBuffer.length === 0) return null;
  const durationMs = (state.speechBuffer.length / (16000 * 2)) * 1000;
  const chunk = durationMs >= VAD_MIN_CHUNK_MS ? state.speechBuffer : null;
  state.speechBuffer = Buffer.alloc(0);
  state.speechStarted = false;
  state.silenceMs = 0;
  return chunk;
}
