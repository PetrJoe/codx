import * as vscode from 'vscode';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatMessage } from '@langchain/core/messages';
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
            modelName: 'codestral-2501', // Fixed: Use codestral-latest instead of mistral-tiny
            temperature: 0.7,
        }),
        diagnostics: vscode.languages.createDiagnosticCollection('codx')
    };

    // Fixed: Use state.client instead of undefined client variable
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: '*' },
        {
            async provideCompletionItems(document, position) {
                const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
                const languageId = document.languageId;

                try {
                    const response = await state.client.invoke([
                        {
                            role: 'user',
                            content: `Provide code completion for ${languageId} code based on this context:\n${prefix}`
                        }
                    ]);
                    const completionText = response.content.toString().trim();
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
            const response = await state.client.invoke([
                {
                    role: 'user',
                    content: `Suggest improvements for this ${document.languageId} code:\n${text}`
                }
            ]);

            const suggestion = response.content.toString().trim();
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
            const response = await state.client.invoke([
                {
                    role: 'user',
                    content: `Refactor this ${editor.document.languageId} code:\n${text}`
                }
            ]);

            await editor.edit(builder => {
                builder.replace(selection, response.content.toString().trim());
            });
            vscode.window.showInformationMessage('Code refactored successfully!');
        } catch (error: any) {
            console.error('Refactor error:', error);
            vscode.window.showErrorMessage('Failed to refactor code.');
        }
    });

    const updateDiagnostics = debounce(async (document: vscode.TextDocument) => {
        try {
            const response = await state.client.invoke([
                {
                    role: 'user',
                    content: `Analyze this ${document.languageId} code for issues:\n${document.getText()}\nReturn JSON: [{ line: number, message: string, severity: "error" | "warning" }]`
                }
            ]);

            let issues: any[] = [];
            try {
                const responseContent = response.content.toString();
                // Extract JSON from response if it's wrapped in markdown
                const jsonMatch = responseContent.match(/(?:json)?\s*(\[[\s\S]*?\])\s*/) || 
                                 responseContent.match(/(\[[\s\S]*?\])/);
                const jsonString = jsonMatch ? jsonMatch[1] : responseContent;
                issues = JSON.parse(jsonString);
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
            const response = await state.client.invoke([
                {
                    role: 'user',
                    content: `Explain this ${editor.document.languageId} code:\n${text}`
                }
            ]);

            // Fixed: Show explanation in a proper webview panel instead of modal
            const panel = vscode.window.createWebviewPanel(
                'codxExplanation',
                'Code Explanation',
                vscode.ViewColumn.Beside,
                { enableScripts: false }
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: sans-serif; margin: 20px; line-height: 1.6; }
                        pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
                        code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
                    </style>
                </head>
                <body>
                    <h2>Code Explanation</h2>
                    <div>${response.content.toString().trim().replace(/\n/g, '<br>')}</div>
                </body>
                </html>
            `;
        } catch (error: any) {
            console.error('Explain error:', error);
            vscode.window.showErrorMessage('Failed to explain code.');
        }
    });

    const formatCommand = vscode.commands.registerCommand('codx.formatCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const selection = editor.selection;
        const text = selection.isEmpty ? document.getText() : document.getText(selection);

        try {
            const response = await state.client.invoke([

               {
                    role: 'user',
                    content: `Format and clean up this ${document.languageId} code, return only the formatted code:\n${text}`
                }
            ]);

            const formattedCode = response.content.toString().trim();
            // Remove code block markers if present
            const cleanCode = formattedCode.replace(/^[\w]*\n?/, '').replace(/\n?$/, '');

            if (selection.isEmpty) {
                const fullRange = new vscode.Range(0, 0, document.lineCount, document.lineAt(document.lineCount - 1).text.length);
                await editor.edit(builder => {
                    builder.replace(fullRange, cleanCode);
                });
            } else {
                await editor.edit(builder => {
                    builder.replace(selection, cleanCode);
                });
            }
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

            const response = await state.client.invoke([
                {
                    role: 'user',
                    content: `Using this file context, answer:\n\n${fileContext}\n\nQuestion: ${question}`
                }
            ]);

            // Fixed: Show response in a proper webview panel
            const panel = vscode.window.createWebviewPanel(
                'codxFileContext',
                'File Context Answer',
                vscode.ViewColumn.Beside,
                { enableScripts: false }
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: sans-serif; margin: 20px; line-height: 1.6; }
                        .question { background: #e3f2fd; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
                        .answer { background: #f5f5f5; padding: 15px; border-radius: 5px; }
                        pre { background: #f0f0f0; padding: 10px; border-radius: 3px; overflow-x: auto; }
                    </style>
                </head>
                <body>
                    <div class="question"><strong>Question:</strong> ${question}</div>
                    <div class="answer">${response.content.toString().trim().replace(/\n/g, '<br>')}</div>
                </body>
                </html>
            `;
        } catch (error: any) {
            console.error('File context error:', error);
            vscode.window.showErrorMessage('Failed to process file context query.');
        }
    });

    const openChatCommand = vscode.commands.registerCommand('codx.openChat', async () => {
        const panel = vscode.window.createWebviewPanel(
            'codxChat', 
            'Codx AI Chat', 
            vscode.ViewColumn.One, 
            { 
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getWebviewContent();

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'ask') {
                try {
                    // Fixed: Use invoke instead of call method
                    const response = await state.client.invoke([
                        { role: 'user', content: message.text }
                    ]);
                    panel.webview.postMessage({ 
                        type: 'response', 
                        text: response.content.toString().trim() 
                    });
                } catch (error: any) {
                    console.error('Chat error:', error);
                    panel.webview.postMessage({ 
                        type: 'error', 
                        text: 'Failed to get response: ' + error.message 
                    });
                }
            }
        });
    });

    function getWebviewContent() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Codx AI Chat</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .chat-container {
            max-width: 800px;
            margin: 0 auto;
        }
        .chat-messages {
            height: 400px;
            overflow-y: auto;
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 15px;
            background: var(--vscode-input-background);
        }
        .message {
            margin-bottom: 15px;
            padding: 10px;
            border-radius: 8px;
        }
        .user-message {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: 20%;
        }
        .ai-message {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            margin-right: 20%;
        }
        .error-message {
            background: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
            border: 1px solid var(--vscode-errorBorder);
        }
        .input-container {
            display: flex;
            gap: 10px;
        }
        #prompt { 
            flex: 1;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            resize: vertical;
            min-height: 60px;
        }
        button {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-family: inherit;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .loading {
            opacity: 0.7;
        }
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <h2>Codx AI Chat</h2>
        <div id="messages" class="chat-messages"></div>
        <div class="input-container">
            <textarea id="prompt" placeholder="Ask a coding question..." rows="3"></textarea>
            <button id="sendBtn" onclick="ask()">Send</button>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const promptInput = document.getElementById('prompt');
        const sendBtn = document.getElementById('sendBtn');
        
        function addMessage(content, type = 'ai') {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}-message\`;
            
            if (type === 'user') {
                messageDiv.innerHTML = \`<strong>You:</strong> \${escapeHtml(content)}\`;
            } else if (type === 'error') {
                messageDiv.innerHTML = \`<strong>Error:</strong> \${escapeHtml(content)}\`;
            } else {
                messageDiv.innerHTML = \`<strong>Codx:</strong> \${formatResponse(content)}\`;
            }
            
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function formatResponse(content) {
            // Basic markdown-like formatting
            let formatted = escapeHtml(content);
            
            // Code blocks
            formatted = formatted.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
            
            // Inline code
            formatted = formatted.replace(/\`([^\`]+)\`/g, '<code style="background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px;">$1</code>');
            
            // Line breaks
            formatted = formatted.replace(/\\n/g, '<br>');
            
            return formatted;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function ask() {
            const text = promptInput.value.trim();
            if (!text) return;
            
            addMessage(text, 'user');
            promptInput.value = '';
            sendBtn.disabled = true;
            sendBtn.textContent = 'Sending...';
            messagesContainer.classList.add('loading');
            
            vscode.postMessage({ command: 'ask', text });
        }
        
        function resetUI() {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            messagesContainer.classList.remove('loading');
        }
        
        // Handle Enter key (Shift+Enter for new line)
        promptInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
            }
        });
        
        window.addEventListener('message', event => {
            const msg = event.data;
            resetUI();
            
            if (msg.type === 'response') {
                addMessage(msg.text, 'ai');
            } else if (msg.type === 'error') {
                addMessage(msg.text, 'error');
            }
        });
        
        // Welcome message
        addMessage('Hello! I\\'m Codx, your AI coding assistant. Ask me anything about programming, code review, debugging, or any coding-related questions!', 'ai');
    </script>
</body>
</html>`;
    }

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        { scheme: 'file', language: '*' },
        {
            provideCodeActions(document, range) {
                const diagnostics = state.diagnostics.get(document.uri) || [];
                const actions: vscode.CodeAction[] = [];
                
                // Add AI quick fix actions for diagnostics in range
                diagnostics.filter(d => d.range.intersection(range)).forEach(diagnostic => {
                    const action = new vscode.CodeAction('🤖 AI Quick Fix', vscode.CodeActionKind.QuickFix);
                    action.command = {
                        command: 'codx.fixCode',
                        title: 'Fix issue with AI',
                        arguments: [document, diagnostic]
                    };
                    action.diagnostics = [diagnostic];
                    actions.push(action);
                });
                
                // Add general AI improvement actions
                if (!range.isEmpty) {
                    const improveAction = new vscode.CodeAction('🤖 AI Improve Code', vscode.CodeActionKind.Refactor);
                    improveAction.command = {
                        command: 'codx.refactorCode',
                        title: 'Improve code with AI'
                    };
                    actions.push(improveAction);
                    
                    const explainAction = new vscode.CodeAction('🤖 AI Explain Code', vscode.CodeActionKind.Empty);
                    explainAction.command = {
                        command: 'codx.explainCode',
                        title: 'Explain code with AI'
                    };
                    actions.push(explainAction);
                }
                
                return actions;
            }
        }
    );

    const fixCommand = vscode.commands.registerCommand('codx.fixCode', async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => {
        const text = document.getText(diagnostic.range);
        try {
            const response = await state.client.invoke([
                {
                    role: 'user',
                    content: `Fix this issue in ${document.languageId} code: "${diagnostic.message}"\nCode:\n${text}\n\nReturn only the fixed code without explanations.`
                }
            ]);

            const fixedCode = response.content.toString().trim();
            // Remove code block markers if present
            const cleanCode = fixedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === document.uri.toString()) {
                await editor.edit(builder => {
                    builder.replace(diagnostic.range, cleanCode);
                });
                vscode.window.showInformationMessage('Issue fixed by AI!');
                
                // Clear the diagnostic after fixing
                const diagnostics = state.diagnostics.get(document.uri) || [];
                const updatedDiagnostics = diagnostics.filter(d => d !== diagnostic);
                state.diagnostics.set(document.uri, updatedDiagnostics);
            }
        } catch (error: any) {
            console.error('Fix error:', error);
            vscode.window.showErrorMessage('Failed to fix issue: ' + error.message);
        }
    });

    // Add status bar item to show extension status
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(robot) Codx AI";
    statusBarItem.tooltip = "Codx AI Assistant is active";
    statusBarItem.command = 'codx.openChat';
    statusBarItem.show();

    // Add context menu commands
    const contextMenuCommands = [
        vscode.commands.registerCommand('codx.contextRefactor', async () => {
            vscode.commands.executeCommand('codx.refactorCode');
        }),
        vscode.commands.registerCommand('codx.contextExplain', async () => {
            vscode.commands.executeCommand('codx.explainCode');
        }),
        vscode.commands.registerCommand('codx.contextFormat', async () => {
            vscode.commands.executeCommand('codx.formatCode');
        })
    ];

    // Register all commands and providers
    context.subscriptions.push(
        completionProvider,
        refactorCommand,
        state.diagnostics,
        explainCommand,
        formatCommand,
        codeActionProvider,
        fixCommand,
        askWithFileContextCommand,
        openChatCommand,
        statusBarItem,
        ...contextMenuCommands
    );

    // Show activation message
    vscode.window.showInformationMessage('Codx AI Assistant is now active! 🤖');
}

export function deactivate() {
    // Cleanup resources if needed
}
