# Realtime Translator

A terminal-based real-time audio translation tool that captures system audio, transcribes it using ElevenLabs Scribe or Google Vertex AI, and translates between Korean and English using AWS Bedrock or Google Vertex AI.

## Features

- **Real-time audio capture** from system loopback devices (BlackHole, Loopback, etc.)
- **Dual transcription engines**: ElevenLabs Scribe (streaming) or Google Vertex AI (batch)
- **Bidirectional translation**: Korean ↔ English with auto-detection
- **Context-aware translation** using sliding window of previous sentences
- **Terminal UI** with live transcript blocks and color-coded output
- **Customizable context** via `context.md` for speaker names, terminology, and style guidance

## Prerequisites

### Required Software

- [Bun](https://bun.sh) runtime
- [ffmpeg](https://ffmpeg.org) with AVFoundation support (macOS)
- Audio loopback device (e.g., [BlackHole](https://existential.audio/blackhole/))

### Required API Keys

Choose one of two engine modes:

**ElevenLabs Mode** (default):
- `ELEVENLABS_API_KEY` - for Scribe transcription
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` - for Bedrock translation

**Vertex Mode**:
- `GOOGLE_APPLICATION_CREDENTIALS` - path to service account JSON
- `GOOGLE_VERTEX_PROJECT_ID` - GCP project ID
- `GOOGLE_VERTEX_PROJECT_LOCATION` - region (default: `global`)

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
```

## Audio Setup (macOS)

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

## Usage

### Basic Usage

```bash
# Start with default settings (ElevenLabs + Bedrock)
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
  --device <name|index>      Audio device (auto-detects BlackHole)
  --direction auto|ko-en|en-ko  Translation direction (default: auto)
  --model <bedrock-id>       Bedrock model ID (default: claude-haiku-4-5-20251001)
  --engine elevenlabs|vertex Transcription engine (default: elevenlabs)
  --vertex-model <id>        Vertex model ID (default: gemini-3-flash-preview)
  --vertex-project <id>      GCP project ID (default: $GOOGLE_VERTEX_PROJECT_ID)
  --vertex-location <id>     GCP region (default: global)
  --context-file <path>      Context file path (default: context.md)
  --no-context               Disable context.md injection
  --compact                  Reduce vertical spacing in output
  --list-devices             List available audio devices
  -h, --help                 Show help
```

### Examples

```bash
# Use Vertex AI for both transcription and translation
bun run dev --engine vertex

# Force Korean to English translation
bun run dev --direction ko-en

# Use specific audio device
bun run dev --device "BlackHole 2ch"

# List available audio devices
bun run dev --list-devices

# Use custom Bedrock model
bun run dev --model claude-sonnet-4-20250514

# Compact output mode
bun run dev --compact
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

## How It Works

### ElevenLabs Mode (Streaming)

1. Captures system audio via ffmpeg → 16kHz mono PCM
2. Streams audio chunks to ElevenLabs Scribe WebSocket
3. Receives real-time transcripts (partial + committed)
4. Translates committed transcripts using AWS Bedrock
5. Displays source and translated text in terminal

### Vertex Mode (Batch)

1. Captures system audio via ffmpeg → 16kHz mono PCM
2. Buffers audio into chunks (default: 3 seconds)
3. Sends audio + prompt to Vertex AI multimodal model
4. Receives JSON response with transcript + translation
5. Displays both in terminal

### Translation Pipeline

- **Sentence extraction**: Splits on `.!?。！？` boundaries
- **Deduplication**: Tracks recent translations to avoid repeats
- **Context window**: Maintains last 10 sentences for coherent translation
- **Language detection**: Auto-detects Korean (Hangul) vs English

## Project Structure

```
translator/
├── src/
│   ├── index.ts        # Main application logic
│   ├── audio.ts        # Audio device detection and ffmpeg streaming
│   ├── translation.ts  # Translation prompts and text processing
│   ├── ui.ts           # Terminal UI rendering
│   └── types.ts        # TypeScript type definitions
├── context.md          # User-provided translation context
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

```bash
# ElevenLabs (required for elevenlabs engine)
ELEVENLABS_API_KEY=your_api_key

# AWS Bedrock (required for elevenlabs engine)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-west-2

# Google Vertex AI (required for vertex engine)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_VERTEX_PROJECT_ID=your-project-id
GOOGLE_VERTEX_PROJECT_LOCATION=global

# Optional overrides
BEDROCK_MODEL_ID=claude-haiku-4-5-20251001
VERTEX_MODEL_ID=gemini-3-flash-preview
```

## Troubleshooting

### No audio detected

- Verify Multi-Output Device is set as system output
- Check BlackHole is included in Multi-Output Device
- Ensure the correct device is selected with `--list-devices`

### ffmpeg not found

```bash
brew install ffmpeg
```

### API errors

- Verify all required environment variables are set
- Check API key validity and quotas
- Ensure AWS region supports your Bedrock model

### Transcription quality issues

- Increase `--interval-ms` for longer audio chunks (Vertex mode)
- Adjust speaker volume and audio quality
- Use `--direction` to force specific language pair

## License

Private repository - all rights reserved.
