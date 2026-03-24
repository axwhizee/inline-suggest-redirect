import * as vscode from "vscode";

let enabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let secrets: vscode.SecretStorage;
let output: vscode.OutputChannel;

// Log message with timestamp to output channel
function log(msg: string) {
    const ts = new Date().toISOString().split("T")[1].split(".")[0];
    output.appendLine(`[${ts}] ${msg}`);
}

// Get all extension settings
function getConfig() {
    const c = vscode.workspace.getConfiguration("inlineSuggestRedirect");
    return {
        endpoint: c.get<string>("endpoint", "https://api.openai.com/v1/chat/completions"),
        model: c.get<string>("model", "gpt-4o-mini"),
        maxTokens: c.get<number>("maxTokens", 128),
        temperature: c.get<number>("temperature", 0.0),
        debounceMs: c.get<number>("debounceMs", 500),
        contextLines: c.get<number>("contextLines", 10),
        timeoutMs: c.get<number>("timeoutMs", 30000),
        extraBody: c.get<Record<string, unknown>>("extraBody"),
        apiKey: c.get<string>("apiKey", ""),
    };
}

// Resolve API key: prefer settings, fallback to SecretStorage
async function getApiKey(): Promise<string | undefined> {
    const { apiKey } = getConfig();
    if (apiKey) { return apiKey; }
    return await secrets.get("inlineSuggestRedirect.apiKey");
}

// Remove markdown code block delimiters from LLM response
function stripCodeFences(text: string): string {
    return text.split("\n")
        .filter(line => !line.trimStart().startsWith("```"))
        .join("\n")
        .trim();
}

// Build prompt with cursor marker and surrounding context
function buildPrompt(doc: vscode.TextDocument, pos: vscode.Position, ctxLines: number): string {
    const start = Math.max(0, pos.line - ctxLines);
    const end = Math.min(doc.lineCount - 1, pos.line + ctxLines);
    const lines: string[] = [];

    for (let i = start; i < pos.line; i++) {
        lines.push(doc.lineAt(i).text);
    }

    const line = doc.lineAt(pos.line).text;
    lines.push(line.slice(0, pos.character) + "<CURSOR>" + line.slice(pos.character));

    for (let i = pos.line + 1; i <= end; i++) {
        lines.push(doc.lineAt(i).text);
    }

    return lines.join("\n");
}

// Extract suggestion text from various API response formats
function extractSuggestion(body: string): string | undefined {
    let j: {
        choices?: { message?: { content?: string }; text?: string }[];
        error?: { message?: string };
        output?: { text?: string };
    };

    try {
        j = JSON.parse(body);
    } catch {
        log(`JSON parse error`);
        return undefined;
    }

    if (j.error) {
        log(`API error: ${j.error.message}`);
        return undefined;
    }

    const raw = j.choices?.[0]?.message?.content
        ?? j.choices?.[0]?.text
        ?? j.output?.text;

    if (!raw) { return undefined; }
    return stripCodeFences(raw);
}

// Core inline completion provider
const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(doc, pos, _ctx, token) {
        if (!enabled) { return { items: [] }; }

        const cfg = getConfig();

        return new Promise((resolve) => {
            if (debounceTimer) { clearTimeout(debounceTimer); }

            debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve({ items: [] });
                    return;
                }

                const key = await getApiKey();
                if (!key) {
                    log("No API key configured");
                    resolve({ items: [] });
                    return;
                }

                const prompt = buildPrompt(doc, pos, cfg.contextLines);
                log(`Request | model=${cfg.model} | prompt=${prompt.length}chars`);

                try {
                    const ctrl = new AbortController();
                    const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);

                    const res = await fetch(cfg.endpoint, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${key}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model: cfg.model,
                            messages: [{ role: "user", content: `Complete the code at <CURSOR>:\n\n${prompt}` }],
                            max_tokens: cfg.maxTokens,
                            temperature: cfg.temperature,
                            extra_body: cfg.extraBody,
                        }),
                        signal: ctrl.signal,
                    });

                    clearTimeout(timeout);

                    if (!res.ok) {
                        log(`HTTP ${res.status}: ${await res.text()}`);
                        resolve({ items: [] });
                        return;
                    }

                    const suggestion = extractSuggestion(await res.text());

                    if (!suggestion) {
                        resolve({ items: [] });
                        return;
                    }

                    log(`Suggestion | ${suggestion.substring(0, 60)}...`);
                    resolve({ items: [new vscode.InlineCompletionItem(suggestion)] });

                } catch (err) {
                    log(`Error: ${err}`);
                    resolve({ items: [] });
                }
            }, cfg.debounceMs);
        });
    }
};

export function activate(ctx: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel("Inline Suggest Redirect");
    secrets = ctx.secrets;

    log("Activated");

    // Register inline completion provider for all file types
    ctx.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider)
    );

    // Command: set API key via input box (stored in SecretStorage)
    ctx.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.setApiKey", async () => {
            const key = await vscode.window.showInputBox({ prompt: "API Key", password: true });
            if (key) {
                await secrets.store("inlineSuggestRedirect.apiKey", key);
                vscode.window.showInformationMessage("API key saved.");
            }
        })
    );

    // Command: enable provider
    ctx.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.enable", () => {
            enabled = true;
            vscode.window.showInformationMessage("Inline Suggest Redirect enabled.");
        })
    );

    // Command: disable provider
    ctx.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.disable", () => {
            enabled = false;
            vscode.window.showInformationMessage("Inline Suggest Redirect disabled.");
        })
    );

    // Command: show output log
    ctx.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.showOutput", () => {
            output.show();
        })
    );
}

export function deactivate() {
    if (debounceTimer) { clearTimeout(debounceTimer); }
}
