# Realtime Translator

A real-time audio translation tool that captures system audio, transcribes with ElevenLabs Scribe v2 by default, and translates with LLM providers.

## Features

- **Real-time audio capture** via ScreenCaptureKit (no loopback device required)
- **Transcription** via ElevenLabs Scribe v2 (default) with optional Gemini/Vertex fallback providers
- **Translation + analysis** via configurable LLM providers
- **Multi-language support**: 13 languages with auto-detection
- **Context-aware translation** using sliding window of previous sentences
- **Full-screen terminal UI** with blessed library, live transcript blocks, and color-coded output
- **Customizable context** via `context.md` for speaker names, terminology, and style guidance
- **Test suite** with Vitest for unit testing audio, translation, and utility functions

## Prerequisites

### Required Software

- [Bun](https://bun.sh) runtime
- **macOS 14.2+** (Sonoma or later) for ScreenCaptureKit audio capture
- Screen Recording permission enabled in System Settings > Privacy & Security > Screen Recording

**Legacy Mode (optional):** For older macOS versions, use `--legacy-audio` flag which requires:
- [ffmpeg](https://ffmpeg.org) with AVFoundation support
- Audio loopback device (e.g., [BlackHole](https://existential.audio/blackhole/))

### Required API Keys

- `ELEVENLABS_API_KEY` - required for default transcription provider (`scribe_v2`)
- `OPENROUTER_API_KEY` - required for default analysis/translation provider
- Optional Gemini/Vertex fallback:
  - `GOOGLE_GENERATIVE_AI_API_KEY` (or `GEMINI_API_KEY`) for provider=`google`
  - `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_VERTEX_PROJECT_ID`, and `GOOGLE_VERTEX_PROJECT_LOCATION` for provider=`vertex`

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd translator

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run tests
bun run test
```

## Audio Setup (macOS)

The app uses **ScreenCaptureKit** to capture system audio directly - no loopback device required.

### First-time Setup

1. On first run, macOS will prompt for **Screen Recording** permission
2. Go to **System Settings > Privacy & Security > Screen Recording**
3. Enable the permission for your terminal app (Terminal, iTerm2, etc.)
4. Restart the terminal and run the app again

### Legacy Mode (macOS < 14.2)

If you're on an older macOS version, use the `--legacy-audio` flag with a loopback device:

1. Install BlackHole:
   ```bash
   brew install blackhole-2ch
   ```

2. Create a Multi-Output Device:
   - Open **Audio MIDI Setup** (Applications > Utilities)
   - Click **+** > **Create Multi-Output Device**
   - Check **BlackHole 2ch** and your speakers
   - Right-click > **Use This Device For Sound Output**

3. Set system audio output to the Multi-Output Device in System Settings > Sound

4. Run with legacy mode:
   ```bash
   bun run dev --legacy-audio
   ```

## Usage

### Basic Usage

```bash
# Start with default settings (ElevenLabs Scribe v2 + OpenRouter analysis)
bun run dev

# Or
bun start
```

### Controls

- `SPACE` - Start/pause recording
- `Q` or `Ctrl+C` - Quit

### Command-Line Options

```bash
bun run dev [options]

Options:
  --source-lang <code>       Input language code (default: ko)
  --target-lang <code>       Output language code (default: en)
  --skip-intro               Skip language selection screen, use CLI values
  --direction auto|source-target  Detection mode (default: auto)
  --vertex-model <id>        Vertex model ID (default: gemini-3-flash-preview)
  --vertex-project <id>      GCP project ID (default: $GOOGLE_VERTEX_PROJECT_ID)
  --vertex-location <id>     GCP region (default: global)
  --context-file <path>      Context file path (default: context.md)
  --no-context               Disable context.md injection
  --compact                  Reduce vertical spacing in output
  --debug                    Enable debug logging
  --legacy-audio             Use ffmpeg + loopback device instead of ScreenCaptureKit
  --device <name|index>      Audio device for legacy mode (auto-detects BlackHole)
  --list-devices             List audio devices (legacy mode only)
  -h, --help                 Show help
```

### Examples

```bash
# Start with default settings (ElevenLabs Scribe v2, ScreenCaptureKit audio)
bun run dev

# Skip intro screen with preset languages
bun run dev --skip-intro --source-lang ja --target-lang en

# Compact output mode
bun run dev --compact

# Legacy mode with loopback device (for older macOS)
bun run dev --legacy-audio --device "BlackHole 2ch"

# List audio devices (legacy mode)
bun run dev --list-devices --legacy-audio
```

## Context File

Create a `context.md` file to provide persistent context for translations:

```markdown
# Translator Context

Speaker names:
- John: CEO, American
- 민지: CTO, Korean

Preferred style:
- Casual, conversational tone
- Preserve technical terms in English

Glossary:
- "배포" → "deployment"
- "이슈" → "issue"
```

The content is injected into the system prompt for every translation, helping maintain consistency with speaker identities, terminology, and style preferences.

## Prompt Tuning

Summary and insight generation prompts are editable on disk:

- `prompts/summary/system.md`
- `prompts/insights/system.md`

These files are loaded at runtime. If a file is missing or empty, the app falls back to built-in defaults.

## How It Works

1. Captures system audio via ScreenCaptureKit → 16kHz mono PCM
2. Voice activity detection segments audio into speech chunks
3. Sends audio chunks to ElevenLabs Speech-to-Text (`scribe_v2`)
4. Optionally post-processes transcript for translation metadata
5. Displays source and translated text in UI

### Translation Pipeline

- **VAD chunking**: Speech segments split on silence boundaries (400ms) or max duration (4s)
- **Deduplication**: Tracks recent translations to avoid repeats
- **Context window**: Maintains last 10 sentences for coherent translation
- **Language detection**: Auto-detects source language from audio

## Project Structure

```
translator/
├── src/
│   ├── index.ts           # Main application logic
│   ├── audio.ts           # Audio device detection and ffmpeg streaming
│   ├── audio.test.ts      # Audio module tests
│   ├── translation.ts     # Translation prompts and text processing
│   ├── translation.test.ts # Translation module tests
│   ├── utils.ts           # Shared utilities (WAV encoding, CLI parsing, text normalization)
│   ├── utils.test.ts      # Utils module tests
│   ├── ui-blessed.ts      # Full-screen terminal UI using blessed
│   ├── ui.ts              # ANSI-based UI helpers and types
│   └── types.ts           # TypeScript type definitions
├── context.md             # User-provided translation context
├── vitest.config.ts       # Vitest test configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

```bash
# Default transcription provider
ELEVENLABS_API_KEY=your-elevenlabs-api-key
TRANSCRIPTION_MODEL_ID=scribe_v2

# Default analysis/translation provider
OPENROUTER_API_KEY=your-openrouter-api-key
ANALYSIS_MODEL_ID=moonshotai/kimi-k2-thinking
# OpenRouter provider routing preference (optional): price | throughput | latency
OPENROUTER_PROVIDER_SORT=throughput

# Optional fallback providers
GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_VERTEX_PROJECT_ID=your-project-id
GOOGLE_VERTEX_PROJECT_LOCATION=global
```

## Troubleshooting

### No audio detected

1. **Check Screen Recording permission** - Go to System Settings > Privacy & Security > Screen Recording and ensure your terminal app is enabled
2. **Restart terminal** - After granting permission, restart your terminal app
3. **Check macOS version** - ScreenCaptureKit requires macOS 14.2+. Use `--legacy-audio` for older versions.

### Legacy mode issues

If using `--legacy-audio`:
- Verify Multi-Output Device is set as system output
- Check BlackHole is included in Multi-Output Device
- Ensure the correct device is selected with `--list-devices --legacy-audio`

### ffmpeg not found (legacy mode only)

```bash
brew install ffmpeg
```

### API errors

- Verify all required environment variables are set
- Check API key validity and quotas

### Transcription quality issues

- Adjust speaker volume and audio quality
- Use `--direction` to force specific language pair

## Development

### Running Tests

```bash
# Run all tests once
bun run test

# Run tests in watch mode
bun run test:watch
```

Tests cover:
- **audio.ts**: Device detection and loopback selection
- **translation.ts**: Language detection, sentence extraction, prompt building
- **utils.ts**: WAV encoding, CLI argument parsing, text normalization

## License

Private repository - all rights reserved.
