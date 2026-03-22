import * as vscode from "vscode";

let isEnabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function getConfig() {
    const cfg = vscode.workspace.getConfiguration("inlineSuggestRedirect");
    return {
        endpoint: cfg.get<string>("endpoint", "https://api.openai.com/v1/chat/completions"),
        model: cfg.get<string>("model", "gpt-4o-mini"),
        maxTokens: cfg.get<number>("maxTokens", 128),
        temperature: cfg.get<number>("temperature", 0.0),
        debounceMs: cfg.get<number>("debounceMs", 500),
        contextLines: cfg.get<number>("contextLines", 10),
        apiKey: cfg.get<string>("apiKey", ""),
    };
}

async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const cfg = getConfig();
    if (cfg.apiKey) return cfg.apiKey;
    return await context.secrets.get("inlineSuggestRedirect.apiKey");
}

function buildPrompt(document: vscode.TextDocument, position: vscode.Position, contextLineCount: number): string {
    const currentLine = document.lineAt(position.line).text;
    const beforeCursor = currentLine.slice(0, position.character);
    const afterCursor = currentLine.slice(position.character);

    const startLine = Math.max(0, position.line - contextLineCount);
    const endLine = Math.min(document.lineCount - 1, position.line + contextLineCount);

    const lines: string[] = [];
    for (let i = startLine; i < position.line; i++) {
        lines.push(document.lineAt(i).text);
    }
    lines.push(beforeCursor + "<CURSOR>" + afterCursor);
    for (let i = position.line + 1; i <= endLine; i++) {
        lines.push(document.lineAt(i).text);
    }

    return lines.join(String.fromCharCode(10));
}

const inlineProvider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, context, token) {
        if (!isEnabled) return { items: [] };

        const config = getConfig();

        return new Promise((resolve) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve({ items: [] });
                    return;
                }

                const key = await getApiKey({} as vscode.ExtensionContext);
                if (!key) {
                    resolve({ items: [] });
                    return;
                }

                const prompt = buildPrompt(document, position, config.contextLines);

                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);

                    const res = await fetch(config.endpoint, {
                        method: "POST",
                        headers: {
                            "Authorization": "Bearer " + key,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model: config.model,
                            messages: [{ role: "user", content: "Complete the code at <CURSOR>:" + String.fromCharCode(10) + String.fromCharCode(10) + prompt }],
                            max_tokens: config.maxTokens,
                            temperature: config.temperature,
                        }),
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (token.isCancellationRequested) {
                        resolve({ items: [] });
                        return;
                    }

                    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
                    const suggestion = j.choices?.[0]?.message?.content?.trim();
                    if (!suggestion) {
                        resolve({ items: [] });
                        return;
                    }

                    const item = new vscode.InlineCompletionItem(suggestion);
                    resolve({ items: [item] });
                } catch {
                    resolve({ items: [] });
                }
            }, config.debounceMs);
        });
    }
};

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, inlineProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.setApiKey", async () => {
            const key = await vscode.window.showInputBox({
                prompt: "Enter your API key",
                password: true,
            });
            if (key) {
                await context.secrets.store("inlineSuggestRedirect.apiKey", key);
                vscode.window.showInformationMessage("API key saved to SecretStorage.");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.enable", () => {
            isEnabled = true;
            vscode.window.showInformationMessage("Inline Suggest Redirect enabled.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("inlineSuggestRedirect.disable", () => {
            isEnabled = false;
            vscode.window.showInformationMessage("Inline Suggest Redirect disabled.");
        })
    );
}

export function deactivate() {
    if (debounceTimer) clearTimeout(debounceTimer);
}