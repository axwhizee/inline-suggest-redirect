# Inline Suggest Redirect

Redirect VS Code's inline completion (ghost text) to any OpenAI-compatible API.

## Features

- Hooks into VS Code's built-in inline suggestion system
- Works with any OpenAI-compatible endpoint (OpenAI, DashScope, Ollama, etc.)
- Configurable debounce, timeout, context window, and extra body params
- API key stored securely via VS Code SecretStorage
- Lightweight: no dependencies beyond VS Code API

## Settings

| Setting | Default | Description |
|---|---|---|
| `endpoint` | `https://api.openai.com/v1/chat/completions` | API endpoint URL |
| `model` | `gpt-4o-mini` | Model ID |
| `maxTokens` | `128` | Max tokens to generate |
| `temperature` | `0.0` | Sampling temperature |
| `debounceMs` | `500` | Delay before sending request (ms) |
| `contextLines` | `10` | Context lines around cursor |
| `timeoutMs` | `30000` | Request timeout (ms) |
| `extraBody` | `{}` | Extra params in request body |
| `apiKey` | `""` | API key (or use SecretStorage) |

## Commands

- **Inline Suggest: Set API Key** — store key in SecretStorage
- **Inline Suggest: Enable** — enable completions
- **Inline Suggest: Disable** — disable completions
- **Inline Suggest: Show Output Log** — view request logs

## Usage

1. Install the extension
2. Run `Inline Suggest: Set API Key` to configure your key
3. Set `inlineSuggestRedirect.endpoint` and `inlineSuggestRedirect.model` in settings
4. Start typing — suggestions appear as ghost text

### DashScope Example

```
endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
model: qwen3.5-plus
extraBody: { "enable_thinking": false }
```

## License

MIT
