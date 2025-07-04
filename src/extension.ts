import * as vscode from 'vscode';
import { ChatMistralAI } from '@langchain/mistralai';

import { v4 as uuidv4 } from 'uuid';

interface ExtensionState {
    apiKey: string;
    client: ChatMistralAI;
    diagnostics: vscode.DiagnosticCollection;
}

function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

export async function activate(context: vscode.ExtensionContext) {
    const apiKey = vscode.workspace.getConfiguration('codx').get<string>('apiKey', '');

    if (!apiKey) {
        vscode.window.showErrorMessage('MistralAI API key is not configured. Please set it in VS Code settings (codx.apiKey).');
        return;
    }

    const state: ExtensionState = {
        apiKey,
        client: new ChatMistralAI({
            apiKey,
            modelName: 'mistral-tiny',
            temperature: 0.7,
        }),
        diagnostics: vscode.languages.createDiagnosticCollection('codx')
    };

    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: '*' },
        {
            async provideCompletionItems(document, position) {
                const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
                const languageId = document.languageId;

                try {
                    const response = await state.client.call([
                        {
                            role: 'user',
                            content: `Provide code completion for ${languageId} code based on this context:\n${prefix}`
                        }
                    ]);

                    const completionText = response.content.trim();
                    const item = new vscode.CompletionItem(completionText, vscode.CompletionItemKind.Snippet);
                    item.range = new vscode.Range(position, position);
                    item.detail = 'AI-generated completion';
                    return [item];
                } catch (error: any) {
                    console.error('Completion error:', error);
                    vscode.window.showErrorMessage('Failed to generate code completion.');
                    return [];
                }
            }
        },
        '.', ' ', '\n'
    );

    const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ' 💡',
            color: '#888888',
            fontStyle: 'italic',
            margin: '0 0 0 1em'
        }
    });

    const provideCodeSuggestions = debounce(async (editor: vscode.TextEditor) => {
        const document = editor.document;
        const selection = editor.selection;
        const text = document.getText(selection);

        if (text.length === 0) {
            editor.setDecorations(decorationType, []);
            return;
        }

        try {
            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Suggest improvements for this ${document.languageId} code:\n${text}`
                }
            ]);

            const suggestion = response.content.trim();
            const decoration = {
                range: selection,
                hoverMessage: new vscode.MarkdownString(`**AI Suggestion**: ${suggestion}`)
            };
            editor.setDecorations(decorationType, [decoration]);
        } catch (error: any) {
            console.error('Suggestion error:', error);
            vscode.window.showErrorMessage('Failed to generate code suggestion.');
        }
    }, 500);

    vscode.window.onDidChangeTextEditorSelection(e => {
        if (!e.selections[0]?.isEmpty) {
            provideCodeSuggestions(e.textEditor);
        } else {
            e.textEditor.setDecorations(decorationType, []);
        }
    }, null, context.subscriptions);

    const refactorCommand = vscode.commands.registerCommand('codx.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (!text) {
            vscode.window.showErrorMessage('Please select code to refactor.');
            return;
        }

        try {
            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Refactor this ${editor.document.languageId} code:\n${text}`
                }
            ]);

            await editor.edit(builder => {
                builder.replace(selection, response.content.trim());
            });
            vscode.window.showInformationMessage('Code refactored successfully!');
        } catch (error: any) {
            console.error('Refactor error:', error);
            vscode.window.showErrorMessage('Failed to refactor code.');
        }
    });

    const updateDiagnostics = debounce(async (document: vscode.TextDocument) => {
        try {
            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Analyze this ${document.languageId} code for issues:\n${document.getText()}\nReturn JSON: [{ line: number, message: string, severity: "error" | "warning" }]`
                }
            ]);

            let issues: any[] = [];
            try {
                issues = JSON.parse(response.content);
            } catch (parseError) {
                console.error('Diagnostics JSON parse error:', parseError);
                return;
            }

            const diagnostics = issues.map((issue: any) => {
                const line = Math.max(0, (issue.line || 1) - 1);
                const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
                const severity = issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
                return new vscode.Diagnostic(range, issue.message || 'Unknown issue', severity);
            });

            state.diagnostics.set(document.uri, diagnostics);
        } catch (error: any) {
            console.error('Diagnostics error:', error);
            vscode.window.showErrorMessage('Failed to analyze code.');
        }
    }, 1000);

    vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document), null, context.subscriptions);
    for (const doc of vscode.workspace.textDocuments) {
        await updateDiagnostics(doc);
    }

    const explainCommand = vscode.commands.registerCommand('codx.explainCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const text = editor.document.getText(editor.selection) || editor.document.getText();
        try {
            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Explain this ${editor.document.languageId} code:\n${text}`
                }
            ]);

            vscode.window.showInformationMessage(response.content.trim(), { modal: true });
        } catch (error: any) {
            console.error('Explain error:', error);
            vscode.window.showErrorMessage('Failed to explain code.');
        }
    });

    const formatCommand = vscode.commands.registerCommand('codx.formatCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const text = document.getText();

        try {
            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Format this ${document.languageId} code:\n${text}`
                }
            ]);

            const fullRange = new vscode.Range(0, 0, document.lineCount, document.lineAt(document.lineCount - 1).text.length);
            await editor.edit(builder => {
                builder.replace(fullRange, response.content.trim());
            });
            vscode.window.showInformationMessage('Code formatted successfully!');
        } catch (error: any) {
            console.error('Format error:', error);
            vscode.window.showErrorMessage('Failed to format code.');
        }
    });

    const askWithFileContextCommand = vscode.commands.registerCommand('codx.askWithFileContext', async () => {
        const fileUris = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Select files for context' });
        if (!fileUris) return;

        const question = await vscode.window.showInputBox({ prompt: 'Ask something based on these files' });
        if (!question) return;

        try {
            let fileContext = '';
            for (const uri of fileUris) {
                const doc = await vscode.workspace.openTextDocument(uri);
                fileContext += `### File: ${uri.fsPath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\`\n\n`;
            }

            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Using this file context, answer:\n\n${fileContext}\n\nQuestion: ${question}`
                }
            ]);

            vscode.window.showInformationMessage('Codx Answer', { modal: true, detail: response.content.trim() });
        } catch (error: any) {
            console.error('File context error:', error);
            vscode.window.showErrorMessage('Failed to process file context query.');
        }
    });

    const openChatCommand = vscode.commands.registerCommand('codx.openChat', async () => {
        const panel = vscode.window.createWebviewPanel('codxChat', 'Codx AI Chat', vscode.ViewColumn.One, { enableScripts: true });

        panel.webview.html = getWebviewContent();

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'ask') {
                try {
                    const response = await state.client.call([{ role: 'user', content: message.text }]);
                    panel.webview.postMessage({ type: 'response', text: response.content.trim() });
                } catch (error: any) {
                    console.error('Chat error:', error);
                    panel.webview.postMessage({ type: 'error', text: 'Failed to get response.' });
                }
            }
        });
    });

    function getWebviewContent() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: sans-serif; margin: 20px; }
        textarea { width: 100%; height: 100px; }
        #response { white-space: pre-wrap; margin-top: 1em; background: #f3f3f3; padding: 1em; border-radius: 5px; }
    </style>
</head>
<body>
    <h2>Codx AI Chat</h2>
    <textarea id="prompt" placeholder="Ask a coding question..."></textarea><br />
    <button onclick="ask()">Ask Codx</button>
    <div id="response"></div>
    <script>
        const vscode = acquireVsCodeApi();
        function ask() {
            const text = document.getElementById('prompt').value;
            vscode.postMessage({ command: 'ask', text });
        }
        window.addEventListener('message', event => {
            const msg = event.data;
            const responseBox = document.getElementById('response');
            if (msg.type === 'response') {
                responseBox.innerText = msg.text;
            } else if (msg.type === 'error') {
                responseBox.innerText = '❌ ' + msg.text;
            }
        });
    </script>
</body>
</html>`;
    }

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        { scheme: 'file', language: '*' },
        {
            provideCodeActions(document, range) {
                const diagnostics = state.diagnostics.get(document.uri) || [];
                return diagnostics.filter(d => d.range.contains(range)).map(diagnostic => {
                    const action = new vscode.CodeAction('AI Quick Fix', vscode.CodeActionKind.QuickFix);
                    action.command = {
                        command: 'codx.fixCode',
                        title: 'Fix issue with AI',
                        arguments: [document, diagnostic]
                    };
                    action.diagnostics = [diagnostic];
                    return action;
                });
            }
        }
    );

    const fixCommand = vscode.commands.registerCommand('codx.fixCode', async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => {
        const text = document.getText(diagnostic.range);
        try {
            const response = await state.client.call([
                {
                    role: 'user',
                    content: `Fix this issue in ${document.languageId} code: "${diagnostic.message}"\nCode:\n${text}`
                }
            ]);

            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === document.uri.toString()) {
                await editor.edit(builder => {
                    builder.replace(diagnostic.range, response.content.trim());
                });
                vscode.window.showInformationMessage('Issue fixed by AI!');
            }
        } catch (error: any) {
            console.error('Fix error:', error);
            vscode.window.showErrorMessage('Failed to fix issue.');
        }
    });

    context.subscriptions.push(
        completionProvider,
        refactorCommand,
        state.diagnostics,
        explainCommand,
        formatCommand,
        codeActionProvider,
        fixCommand,
        askWithFileContextCommand,
        openChatCommand
    );
}

export function deactivate() {}