# paige

Compact server for extracting character names and summarizing text with model-assisted inference. Provides HTTP
endpoints and a developer userscript `paige.userscript.js` for integration.

> [!NOTE]  
> This project expects Go 1.25+ and runs on Windows (instructions use PowerShell/CMD). The server saves runtime data to
> the working directory (e.g. `CharacterSummary.json`, `Forbids.json`).

## Features

- POST `/api/names` — infer character names (model + heuristic fallback)
- POST `/api/summarize` — summarize text or paragraphs into structured JSON (SSE progress)
- GET `/userscript` — optional dev helper that serves the local `paige.userscript.js` for easy install/refresh

## Requirements

- Go 1.25 or newer
- An OpenAI-compatible API key, Grok API key, or Gemini API key for inference calls
- Alternatively, a local LM Studio endpoint can be used if no API keys are provided

## Environment variables

> [!IMPORTANT]
> `OPENAI_API_KEY` at least one API key is required; without any API key the server falls back to the local LM Studio endpoint.

- `OPENAI_API_KEY` — OpenAI-compatible API key used by the primary inferencer.
- `OPENAI_MODEL` — Optional model name for OpenAI (or the default configured by the client).
- `GROK_API_KEY` — API key for the Grok inferencer (takes precedence if `OPENAI_API_KEY` is absent).
- `GROK_MODEL` — Grok model identifier used when `GROK_API_KEY` is set.
- `GEMINI_API_KEY` — API key for the Gemini inferencer (used if both OpenAI and Grok keys are absent).
- `GEMINI_MODEL` — Gemini model identifier, relevant when `GEMINI_API_KEY` is provided.
- `PORT` — HTTP port to bind; defaults to `8080`.

> [!IMPORTANT]  
> Make sure `OPENAI_API_KEY` is set before running the server. The server will attempt inference calls using that key.

## Quick start

- Build:

```powershell
powershell
go build -o paige.exe ./...
```

- Run (cmd):

```bash
cmd
set OPENAI_API_KEY=sk-...
set PORT=8080
paige.exe
```

## Install `paige.userscript.js` (developer userscript)

Options to install the userscript into your browser for dev testing: [paige.userscript.js](./userscript/paige.userscript.js).

- Local file install
    1. Ensure `paige.userscript.js` exists in the project root.
    2. Open the file in an editor and copy its contents.
    3. Install a userscript manager (Tampermonkey / Violentmonkey / Greasemonkey).
    4. Open the [userscript](./userscript/paige.userscript.js) page and click "Raw".

> [!NOTE]  
> The summarization endpoint can accept `paragraphs` (map of index→text) or a raw `text` string. It streams progress
> events (SSE) during processing.

## Persistence & runtime files

- `CharacterSummary.json` — saved summaries
- `Forbids.json` — saved forbidden content records

## Troubleshooting

- If inference calls fail with permission/forbidden errors, check your API key and any custom `OPENAI_API_BASE`.
- If the userscript is stale, install it from the running server route to get the latest local copy.
