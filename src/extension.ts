import * as vscode from 'vscode';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatMessage } from '@langchain/core/messages';

interface ModelConfig {
    name: string;
    displayName: string;
    description: string;
    maxTokens?: number;
    temperature?: number;
}

interface ExtensionState {
    apiKey: string;
    currentModel: string;
    models: Map<string, ModelConfig>;
    clients: Map<string, ChatMistralAI>;
    diagnostics: vscode.DiagnosticCollection;
}

// Available Mistral models
const AVAILABLE_MODELS: ModelConfig[] = [
    {
        name: 'codestral-2501',
        displayName: 'Codestral 2501',
        description: 'Latest code-specialized model (recommended for coding)',
        maxTokens: 32768,
        temperature: 0.1
    },
    {
        name: 'codestral-latest',
        displayName: 'Codestral Latest',
        description: 'Always the latest Codestral model',
        maxTokens: 32768,
        temperature: 0.1
    },
    {
        name: 'mistral-large-latest',
        displayName: 'Mistral Large Latest',
        description: 'Most capable model for complex reasoning',
        maxTokens: 32768,
        temperature: 0.7
    },
    {
        name: 'mistral-small-latest',
        displayName: 'Mistral Small Latest',
        description: 'Fast and efficient for simple tasks',
        maxTokens: 32768,
        temperature: 0.7
    },
    {
        name: 'open-mistral-7b',
        displayName: 'Open Mistral 7B',
        description: 'Open source model, good for general tasks',
        maxTokens: 32768,
        temperature: 0.7
    },
    {
        name: 'open-mixtral-8x7b',
        displayName: 'Open Mixtral 8x7B',
        description: 'Mixture of experts model, balanced performance',
        maxTokens: 32768,
        temperature: 0.7
    },
    {
        name: 'open-mixtral-8x22b',
        displayName: 'Open Mixtral 8x22B',
        description: 'Larger mixture of experts model',
        maxTokens: 65536,
        temperature: 0.7
    }
];

function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function createClient(apiKey: string, modelConfig: ModelConfig): ChatMistralAI {
    return new ChatMistralAI({
        apiKey,
        modelName: modelConfig.name,
        temperature: modelConfig.temperature || 0.7,
        maxTokens: modelConfig.maxTokens || 32768,
    });
}

function getCurrentClient(state: ExtensionState): ChatMistralAI {
    const client = state.clients.get(state.currentModel) || state.clients.values().next().value;
    if (!client) {
        throw new Error('No MistralAI client available');
    }
    return client;
}

export async function activate(context: vscode.ExtensionContext) {
    const apiKey = vscode.workspace.getConfiguration('codx').get<string>('apiKey', '');

    if (!apiKey) {
        vscode.window.showErrorMessage('MistralAI API key is not configured. Please set it in VS Code settings (codx.apiKey).');
        return;
    }

    // Initialize models and clients
    const models = new Map<string, ModelConfig>();
    const clients = new Map<string, ChatMistralAI>();
    
    AVAILABLE_MODELS.forEach(model => {
        models.set(model.name, model);
        clients.set(model.name, createClient(apiKey, model));
    });

    // Get saved model preference or default to codestral-2501
    const savedModel = context.globalState.get<string>('codx.selectedModel', 'codestral-2501');
    const currentModel = models.has(savedModel) ? savedModel : 'codestral-2501';

    const state: ExtensionState = {
        apiKey,
        currentModel,
        models,
        clients,
        diagnostics: vscode.languages.createDiagnosticCollection('codx')
    };

    // Create activity bar item
    const activityBarItem = vscode.window.createTreeView('codx-activity-bar', {
        treeDataProvider: {
            getTreeItem: () => ({
                id: 'codx-main',
                label: 'Codx AI',
                iconPath: new vscode.ThemeIcon('circuit-board'),
                command: { command: 'codx.openChat', title: 'Open Codx AI Chat' }
            }),
            getChildren: () => [{
                id: 'codx-main',
                label: 'Codx AI',
                iconPath: new vscode.ThemeIcon('circuit-board'),
                command: { command: 'codx.openChat', title: 'Open Codx AI Chat' }
            }]
        }
    });

    // Model selection command
    const selectModelCommand = vscode.commands.registerCommand('codx.selectModel', async () => {
        const items = Array.from(state.models.values()).map(model => ({
            label: model.displayName,
            description: model.name,
            detail: model.description,
            model: model.name
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select AI model',
            title: `Current: ${state.models.get(state.currentModel)?.displayName || state.currentModel}`
        });

        if (selected) {
            state.currentModel = selected.model;
            await context.globalState.update('codx.selectedModel', selected.model);
            updateStatusBarItem(statusBarItem, state);
            vscode.window.showInformationMessage(`Switched to ${selected.label}`);
        }
    });

    // Model-specific completion provider
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: '*' },
        {
            async provideCompletionItems(document, position) {
                const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
                const languageId = document.languageId;
                const client = getCurrentClient(state);

                try {
                    const response = await client.invoke([
                        {
                            role: 'user',
                            content: `Provide code completion for ${languageId} code based on this context:\n${prefix}`
                        }
                    ]);
                    const completionText = response.content.toString().trim();
                    const item = new vscode.CompletionItem(completionText, vscode.CompletionItemKind.Snippet);
                    item.range = new vscode.Range(position, position);
                    item.detail = `AI-generated completion (${state.models.get(state.currentModel)?.displayName})`;
                    return [item];
                } catch (error: any) {
                    console.error('Completion error:', error);
                    vscode.window.showErrorMessage(`Failed to generate code completion with ${state.models.get(state.currentModel)?.displayName}.`);
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

        const client = getCurrentClient(state);

        try {
            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Suggest improvements for this ${document.languageId} code:\n${text}`
                }
            ]);

            const suggestion = response.content.toString().trim();
            const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
            const decoration = {
                range: selection,
                hoverMessage: new vscode.MarkdownString(`**AI Suggestion (${modelName})**: ${suggestion}`)
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

        const client = getCurrentClient(state);

        try {
            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Refactor this ${editor.document.languageId} code:\n${text}`
                }
            ]);

            await editor.edit(builder => {
                builder.replace(selection, response.content.toString().trim());
            });
            const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
            vscode.window.showInformationMessage(`Code refactored successfully with ${modelName}!`);
        } catch (error: any) {
            console.error('Refactor error:', error);
            vscode.window.showErrorMessage('Failed to refactor code.');
        }
    });

    const updateDiagnostics = debounce(async (document: vscode.TextDocument) => {
        const client = getCurrentClient(state);
        
        try {
            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Analyze this ${document.languageId} code for issues:\n${document.getText()}\nReturn JSON: [{ line: number, message: string, severity: "error" | "warning" }]`
                }
            ]);

            let issues: any[] = [];
            try {
                const responseContent = response.content.toString();
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
        const client = getCurrentClient(state);
        
        try {
            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Explain this ${editor.document.languageId} code:\n${text}`
                }
            ]);

            const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
            const panel = vscode.window.createWebviewPanel(
                'codxExplanation',
                `Code Explanation - ${modelName}`,
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
                        .model-info { background: #e3f2fd; padding: 10px; border-radius: 5px; margin-bottom: 15px; font-size: 0.9em; }
                        pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
                        code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
                    </style>
                </head>
                <body>
                    <div class="model-info">Generated by: <strong>${modelName}</strong></div>
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
        const client = getCurrentClient(state);

        try {
            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Format and clean up this ${document.languageId} code, return only the formatted code:\n${text}`
                }
            ]);

            const formattedCode = response.content.toString().trim();
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
            const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
            vscode.window.showInformationMessage(`Code formatted successfully with ${modelName}!`);
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

        const client = getCurrentClient(state);

        try {
            let fileContext = '';
            for (const uri of fileUris) {
                const doc = await vscode.workspace.openTextDocument(uri);
                fileContext += `### File: ${uri.fsPath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\`\n\n`;
            }

            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Using this file context, answer:\n\n${fileContext}\n\nQuestion: ${question}`
                }
            ]);

            const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
            const panel = vscode.window.createWebviewPanel(
                'codxFileContext',
                `File Context Answer - ${modelName}`,
                vscode.ViewColumn.Beside,
                { enableScripts: true } // Enable scripts for copy/apply buttons
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: sans-serif; margin: 20px; line-height: 1.6; }
                        .model-info { background: #e3f2fd; padding: 10px; border-radius: 5px; margin-bottom: 15px; font-size: 0.9em; }
                        .question { background: #f3e5f5; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
                        .answer { background: #f5f5f5; padding: 15px; border-radius: 5px; }
                        pre { background: #f0f0f0; padding: 10px; border-radius: 3px; overflow-x: auto; }
                        .action-buttons { margin-top: 10px; display: flex; gap: 10px; }
                        button { padding: 8px 16px; cursor: pointer; border: none; border-radius: 4px; }
                        .copy-btn { background: #4CAF50; color: white; }
                        .apply-btn { background: #2196F3; color: white; }
                    </style>
                </head>
                <body>
                    <div class="model-info">Generated by: <strong>${modelName}</strong></div>
                    <div class="question"><strong>Question:</strong> ${question}</div>
                    <div class="answer">${response.content.toString().trim().replace(/\n/g, '<br>')}</div>
                    <div class="action-buttons">
                        <button class="copy-btn" onclick="copyToClipboard()">Copy</button>
                        <button class="apply-btn" onclick="applyChanges()">Apply to File</button>
                    </div>
                    <script>
                        const vscode = acquireVsCodeApi();
                        function copyToClipboard() {
                            navigator.clipboard.writeText(\`${response.content.toString().trim()}\`);
                            vscode.postMessage({ command: 'notify', text: 'Response copied to clipboard!' });
                        }
                        function applyChanges() {
                            vscode.postMessage({ command: 'applyChanges', text: \`${response.content.toString().trim()}\` });
                        }
                    </script>
                </body>
                </html>
            `;

            panel.webview.onDidReceiveMessage(async message => {
                if (message.command === 'notify') {
                    vscode.window.showInformationMessage(message.text);
                } else if (message.command === 'applyChanges') {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        await editor.edit(builder => {
                            const selection = editor.selection;
                            const range = selection.isEmpty 
                                ? new vscode.Range(0, 0, editor.document.lineCount, 0)
                                : selection;
                            builder.replace(range, message.text);
                        });
                        vscode.window.showInformationMessage('Changes applied to file!');
                    } else {
                        vscode.window.showErrorMessage('No active editor to apply changes.');
                    }
                }
            });
        } catch (error: any) {
            console.error('File context error:', error);
            vscode.window.showErrorMessage('Failed to process file context query.');
        }
    });

    const openChatCommand = vscode.commands.registerCommand('codx.openChat', async () => {
        const panel = vscode.window.createWebviewPanel(
            'codxChat', 
            `Codx AI Chat - ${state.models.get(state.currentModel)?.displayName || ''}`, 
            vscode.ViewColumn.One, 
            { 
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getWebviewContent(state);

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'ask') {
                const client = getCurrentClient(state);
                try {
                    let content = message.text;
                    let fileContext = '';

                    // Check for file mentions in the format [[file_path]]
                    const fileMentions = message.text.match(/\[\[([^\]]*)\]\]/g);
                    if (fileMentions) {
                        for (const mention of fileMentions) {
                            const filePath = mention.slice(2, -2);
                            try {
                                const uri = vscode.Uri.file(filePath);
                                const doc = await vscode.workspace.openTextDocument(uri);


                                fileContext += `### File: ${filePath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\`\n\n`;
                                content = content.replace(mention, `(referenced ${filePath})`);
                            } catch (error) {

                                console.error(`Failed to load file ${filePath}:`, error);
                            }
                        }
                    }

                    const prompt = fileContext ? `${fileContext}\n\nQuestion: ${content}` : content;
                    const response = await client.invoke([
                        { role: 'user', content: prompt }
                    ]);
                    panel.webview.postMessage({ 
                        type: 'response', 
                        text: response.content.toString().trim(),
                        model: state.models.get(state.currentModel)?.displayName || state.currentModel
                    });
                } catch (error: any) {
                    console.error('Chat error:', error);
                    panel.webview.postMessage({ 
                        type: 'error', 
                        text: 'Failed to get response: ' + error.message 
                    });
                }
            } else if (message.command === 'switchModel') {
                vscode.commands.executeCommand('codx.selectModel');
            } else if (message.command === 'getCurrentModel') {
                panel.webview.postMessage({
                    type: 'modelUpdate',
                    model: state.models.get(state.currentModel)?.displayName || state.currentModel,
                    modelId: state.currentModel
                });
            } else if (message.command === 'copyResponse') {
                vscode.window.showInformationMessage('Response copied to clipboard!');
            } else if (message.command === 'applyChanges') {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    await editor.edit(builder => {
                        const selection = editor.selection;
                        const range = selection.isEmpty 
                            ? new vscode.Range(0, 0, editor.document.lineCount, 0)
                            : selection;
                        builder.replace(range, message.text);
                    });
                    vscode.window.showInformationMessage('Changes applied to file!');
                } else {
                    vscode.window.showErrorMessage('No active editor to apply changes.');
                }
            }
        });
    });

    function getWebviewContent(state: ExtensionState) {
        const currentModel = state.models.get(state.currentModel);

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
        .model-selector {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px;
        }
        .model-info {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-left: 10px;
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
            position: relative;
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
        .message-header {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 5px;
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
        .btn {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-family: inherit;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn:disabled {
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
        .switch-model-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 5px 10px;
            font-size: 0.9em;
        }
        .switch-model-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .action-buttons {
            position: absolute;
            top: 10px;
            right: 10px;
            display: flex;
            gap: 5px;
        }
        .action-btn {
            padding: 5px 10px;
            font-size: 0.8em;
        }
        .copy-btn { background: #4CAF50; color: white; }
        .apply-btn { background: #2196F3; color: white; }
    </style>
</head>
<body>
    <div class="chat-container">
        <h2>Codx AI Chat</h2>
        <div class="model-selector">
            <strong>Model:</strong>
            <span id="currentModel">${currentModel?.displayName || state.currentModel}</span>
            <button class="btn switch-model-btn" onclick="switchModel()">Switch Model</button>
            <div class="model-info" id="modelInfo">${currentModel?.description || ''}</div>
        </div>
        <div id="messages" class="chat-messages"></div>
        <div class="input-container">
            <textarea id="prompt" placeholder="Ask a coding question (mention files using [[path/to/file]])..." rows="3"></textarea>
            <button id="sendBtn" class="btn" onclick="ask()">Send</button>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const promptInput = document.getElementById('prompt');
        const sendBtn = document.getElementById('sendBtn');
        const currentModelSpan = document.getElementById('currentModel');
        const modelInfoDiv = document.getElementById('modelInfo');
        
        function addMessage(content, type = 'ai', model = null) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}-message\`;
            
            let headerText = '';
            if (type === 'user') {
                headerText = 'You:';
            } else if (type === 'error') {
                headerText = 'Error:';
            } else {
                headerText = model ? \`Codx (\${model}):\` : 'Codx:';
            }
            
            const headerDiv = document.createElement('div');
            headerDiv.className = 'message-header';
            headerDiv.textContent = headerText;
            
            const contentDiv = document.createElement('div');
            if (type === 'user' || type === 'error') {
                contentDiv.innerHTML = escapeHtml(content);
            } else {
                contentDiv.innerHTML = formatResponse(content);
                const actionButtons = document.createElement('div');
                actionButtons.className = 'action-buttons';
                actionButtons.innerHTML = `
                    <button class="btn action-btn copy-btn" onclick="copyToClipboard(this)">Copy</button>
                    <button class="btn action-btn apply-btn" onclick="applyChanges(this)">Apply</button>
                `;
                messageDiv.appendChild(actionButtons);
            }
            
            messageDiv.appendChild(headerDiv);
            messageDiv.appendChild(contentDiv);
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function formatResponse(content) {
            let formatted = escapeHtml(content);
            formatted = formatted.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
            formatted = formatted.replace(/\`([^\`]+)\`/g, '<code style="background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px;">$1</code>');
            formatted = formatted.replace(/\\n/g, '<br>');
            return formatted;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function copyToClipboard(btn) {
            const messageDiv = btn.closest('.message');
            const contentDiv = messageDiv.querySelector('div:not(.message-header):not(.action-buttons)');
            navigator.clipboard.writeText(contentDiv.textContent);
            vscode.postMessage({ command: 'copyResponse', text: 'Response copied to clipboard!' });
        }
        
        function applyChanges(btn) {
            const messageDiv = btn.closest('.message');
            const contentDiv = messageDiv.querySelector('div:not(.message-header):not(.action-buttons)');
            vscode.postMessage({ command: 'applyChanges', text: contentDiv.textContent });
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
        
        function switchModel() {
            vscode.postMessage({ command: 'switchModel' });
        }
        
        function resetUI() {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            messagesContainer.classList.remove('loading');
        }
        
        function updateModelDisplay(modelName, modelId) {
            currentModelSpan.textContent = modelName;
        }
        
        promptInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
            }
        });
        
        window.addEventListener('message', event => {
            const msg = event.data;
            
            if (msg.type === 'response') {
                resetUI();
                addMessage(msg.text, 'ai', msg.model);
            } else if (msg.type === 'error') {
                resetUI();
                addMessage(msg.text, 'error');
            } else if (msg.type === 'modelUpdate') {
                updateModelDisplay(msg.model, msg.modelId);
            }
        });
        
        addMessage('Hello! I\\'m Codx, your AI coding assistant. Ask me anything about programming, code review, debugging, or any coding-related questions! Use [[path/to/file]] to reference files.', 'ai', currentModelSpan.textContent);
        
        vscode.postMessage({ command: 'getCurrentModel' });
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
        const client = getCurrentClient(state);
        
        try {
            const response = await client.invoke([
                {
                    role: 'user',
                    content: `Fix this issue in ${document.languageId} code: "${diagnostic.message}"\nCode:\n${text}\n\nReturn only the fixed code without explanations.`
                }
            ]);

            const fixedCode = response.content.toString().trim();
            const cleanCode = fixedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === document.uri.toString()) {
                await editor.edit(builder => {
                    builder.replace(diagnostic.range, cleanCode);
                });
                const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
                vscode.window.showInformationMessage(`Issue fixed by AI (${modelName})!`);
                
                const diagnostics = state.diagnostics.get(document.uri) || [];
                const updatedDiagnostics = diagnostics.filter(d => d !== diagnostic);
                state.diagnostics.set(document.uri, updatedDiagnostics);
            }
        } catch (error: any) {
            console.error('Fix error:', error);
            vscode.window.showErrorMessage('Failed to fix issue: ' + error.message);
        }
    });

    const compareModelsCommand = vscode.commands.registerCommand('codx.compareModels', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Please open a file to compare models.');
            return;
        }

        const text = editor.document.getText(editor.selection) || editor.document.getText();
        if (!text.trim()) {
            vscode.window.showErrorMessage('Please select some code or ensure the file has content.');
            return;
        }

        const task = await vscode.window.showQuickPick([
            { label: 'Explain Code', value: 'explain' },
            { label: 'Refactor Code', value: 'refactor' },
            { label: 'Find Issues', value: 'analyze' },
            { label: 'Add Comments', value: 'comment' }
        ], { placeHolder: 'What would you like to compare across models?' });

        if (!task) return;

        const selectedModels = await vscode.window.showQuickPick(
            Array.from(state.models.values()).map(model => ({
                label: model.displayName,
                description: model.name,
                detail: model.description,
                picked: model.name === state.currentModel
            })),
            { 
                canPickMany: true, 
                placeHolder: 'Select models to compare (2-4 recommended)',
                title: 'Model Comparison'
            }
        );

        if (!selectedModels || selectedModels.length < 2) {
            vscode.window.showErrorMessage('Please select at least 2 models to compare.');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'codxModelComparison',
            'Model Comparison',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = getComparisonWebviewContent(selectedModels, task.label);

        const results: Array<{model: string, result: string, error?: string}> = [];
        
        for (const model of selectedModels) {
            const client = state.clients.get(model.description!);
            if (!client) continue;

            try {
                let prompt = '';
                switch (task.value) {
                    case 'explain':
                        prompt = `Explain this ${editor.document.languageId} code:\n${text}`;
                        break;
                    case 'refactor':
                        prompt = `Refactor this ${editor.document.languageId} code:\n${text}`;
                        break;
                    case 'analyze':
                        prompt = `Analyze this ${editor.document.languageId} code for potential issues:\n${text}`;
                        break;
                    case 'comment':
                        prompt = `Add helpful comments to this ${editor.document.languageId} code:\n${text}`;
                        break;
                }

                const response = await client.invoke([{ role: 'user', content: prompt }]);
                results.push({
                    model: model.label,
                    result: response.content.toString().trim()
                });
            } catch (error: any) {
                results.push({
                    model: model.label,
                    result: '',
                    error: error.message
                });
            }

            panel.webview.postMessage({
                type: 'progress',
                completed: results.length,
                total: selectedModels.length
            });
        }

        panel.webview.postMessage({
            type: 'results',
            results: results
        });
    });

    function getComparisonWebviewContent(models: any[], taskName: string) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Model Comparison</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .task-info {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 20px;
        }
        .progress {
            background: var(--vscode-progressBar-background);
            border-radius: 10px;
            height: 20px;
            margin: 20px 0;
            overflow: hidden;
        }
        .progress-bar {
            background: var(--vscode-button-background);
            height: 100%;
            width: 0%;
            transition: width 0.3s ease;
        }
        .results-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .model-result {
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 15px;
            background: var(--vscode-input-background);
        }
        .model-header {
            font-weight: bold;
            font-size: 1.1em;
            margin-bottom: 10px;
            color: var(--vscode-button-background);
        }
        .model-content {
            white-space: pre-wrap;
            line-height: 1.5;
        }
        .error {
            color: var(--vscode-errorForeground);
            background: var(--vscode-errorBackground);
            padding: 10px;
            border-radius: 5px;
        }
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Model Comparison</h1>
        <div class="task-info">
            <strong>Task:</strong> ${taskName}<br>
            <strong>Models:</strong> ${models.map(m => m.label).join(', ')}
        </div>
    </div>
    
    <div class="progress">
        <div class="progress-bar" id="progressBar"></div>
    </div>
    
    <div id="status" class="loading">Processing models...</div>
    
    <div id="results" class="results-container" style="display: none;"></div>

    <script>
        const vscode = acquireVsCodeApi();
        const progressBar = document.getElementById('progressBar');
        const status = document.getElementById('status');
        const resultsContainer = document.getElementById('results');
        
        window.addEventListener('message', event => {
            const msg = event.data;
            
            if (msg.type === 'progress') {
                const percentage = (msg.completed / msg.total) * 100;
                progressBar.style.width = percentage + '%';
                status.textContent = \`Processing... (\${msg.completed}/\${msg.total})\`;
            } else if (msg.type === 'results') {
                status.style.display = 'none';
                resultsContainer.style.display = 'grid';
                
                msg.results.forEach(result => {
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'model-result';
                    
                    const headerDiv = document.createElement('div');
                    headerDiv.className = 'model-header';
                    headerDiv.textContent = result.model;
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'model-content';
                    
                    if (result.error) {
                        contentDiv.innerHTML = \`<div class="error">Error: \${result.error}</div>\`;
                    } else {
                        let formatted = result.result;
                        formatted = formatted.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
                        formatted = formatted.replace(/\`([^\`]+)\`/g, '<code style="background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px;">$1</code>');
                        formatted = formatted.replace(/\\n/g, '<br>');
                        contentDiv.innerHTML = formatted;
                    }
                    
                    resultDiv.appendChild(headerDiv);
                    resultDiv.appendChild(contentDiv);
                    resultsContainer.appendChild(resultDiv);
                });
            }
        });
    </script>
</body>
</html>`;
    }

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    
    function updateStatusBarItem(statusBarItem: vscode.StatusBarItem, state: ExtensionState) {
        const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
        statusBarItem.text = `$(robot) Codx AI (${modelName})`;
        statusBarItem.tooltip = `Codx AI Assistant - Current model: ${modelName}\nClick to open menu`;
        statusBarItem.command = 'codx.statusBarMenu';
    }
    
    updateStatusBarItem(statusBarItem, state);
    statusBarItem.show();

    const showModelInfoCommand = vscode.commands.registerCommand('codx.showModelInfo', async () => {
        const items = Array.from(state.models.values()).map(model => ({
            label: model.displayName,
            description: model.name,
            detail: model.description,
            model: model
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a model to view details',
            title: 'Model Information'
        });

        if (selected) {
            const model = selected.model;
            vscode.window.showInformationMessage(
                `${model.displayName}\n\nModel ID: ${model.name}\nDescription: ${model.description}\nMax Tokens: ${model.maxTokens || 'Default'}\nTemperature: ${model.temperature || 'Default'}`,
                { modal: true }
            );
        }
    });

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

    const statusBarContextMenu = vscode.commands.registerCommand('codx.statusBarMenu', async () => {
        const items = [
            {
                label: '$(comment-discussion) Open Chat',
                description: 'Open AI chat interface',
                command: 'codx.openChat'
            },
            {
                label: '$(settings-gear) Switch Model',
                description: `Current: ${state.models.get(state.currentModel)?.displayName}`,
                command: 'codx.selectModel'
            },
            {
                label: '$(info) Model Information',
                description: 'View model details',
                command: 'codx.showModelInfo'
            },
            {
                label: '$(compare-changes) Compare Models',
                description: 'Compare responses from different models',
                command: 'codx.compareModels'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Codx AI Actions',
            title: 'What would you like to do?'
        });

        if (selected) {
            vscode.commands.executeCommand(selected.command);
        }
    });

    const hoverProvider = vscode.languages.registerHoverProvider(
        { scheme: 'file', language: '*' },
        {
            async provideHover(document, position) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document !== document) return;

                const selection = editor.selection;
                let text = '';
                let range: vscode.Range;

                if (!selection.isEmpty) {
                    text = document.getText(selection);
                    range = selection;
                } else {
                    const wordRange = document.getWordRangeAtPosition(position);
                    if (!wordRange) return;
                    text = document.getText(wordRange);
                    range = wordRange;
                }

                if (text.length < 3 || text.length > 200) return;

                try {
                    const client = getCurrentClient(state);
                    const response = await client.invoke([
                        {
                            role: 'user',
                            content: `Briefly explain this ${document.languageId} code element: "${text}". Keep it concise (1-2 sentences).`
                        }
                    ]);

                    const explanation = response.content.toString().trim();
                    const modelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
                    
                    return new vscode.Hover(
                        new vscode.MarkdownString(`**AI Explanation (${modelName}):** ${explanation}`),
                        range
                    );
                } catch (error) {
                    console.error('Hover error:', error);
                    return;
                }
            }
        }
    );

    const workspaceSymbolProvider = vscode.languages.registerWorkspaceSymbolProvider({
        async provideWorkspaceSymbols(query) {
            if (!query.startsWith('ai:')) return [];
            
            const searchQuery = query.substring(3).trim();
            if (!searchQuery) return [];

            try {
                const client = getCurrentClient(state);
                const workspaceFiles = await vscode.workspace.findFiles('**/*.{js,ts,py,java,cpp,c,cs,go,rs,php}', '**/node_modules/**', 50);
                
                let codeContext = '';
                for (const file of workspaceFiles.slice(0, 10)) {
                    const doc = await vscode.workspace.openTextDocument(file);
                    codeContext += `File: ${file.fsPath}\n${doc.getText().substring(0, 1000)}\n\n`;
                }

                const response = await client.invoke([
                    {
                        role: 'user',
                        content: `Search for code related to: "${searchQuery}" in this codebase context:\n${codeContext}\n\nReturn relevant file paths and line numbers where applicable.`
                    }
                ]);

                return [];
            } catch (error) {
                console.error('Workspace symbol search error:', error);
                return [];
            }
        }
    });

    const validateConfiguration = () => {
        const config = vscode.workspace.getConfiguration('codx');
        const apiKey = config.get<string>('apiKey', '');
        
        if (!apiKey) {
            vscode.window.showWarningMessage(
                'Codx AI: API key not configured. Some features may not work.',
                'Configure'
            ).then(selection => {
                if (selection === 'Configure') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'codx.apiKey');
                }
            });
        }
    };

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('codx.apiKey')) {
            const newApiKey = vscode.workspace.getConfiguration('codx').get<string>('apiKey', '');
            if (newApiKey !== state.apiKey) {
                vscode.window.showInformationMessage('API key changed. Please reload the window to apply changes.', 'Reload')
                    .then(selection => {
                        if (selection === 'Reload') {
                            vscode.commands.executeCommand('workbench.action.reloadWindow');
                        }
                    });
            }
        }
    });

    const recommendModel = (languageId: string): string => {
        const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php'];
        
        if (codeLanguages.includes(languageId)) {
            return 'codestral-2501';
        } else if (languageId === 'markdown' || languageId === 'plaintext') {
            return 'mistral-large-latest';
        } else {
            return state.currentModel;
        }
    };

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return;
        
        const disableRecommendations = context.globalState.get<boolean>('codx.disableModelRecommendations', false);
        if (disableRecommendations) return;
        
        const recommendedModel = recommendModel(editor.document.languageId);
        if (recommendedModel !== state.currentModel) {
            const modelName = state.models.get(recommendedModel)?.displayName;
            vscode.window.showInformationMessage(
                `Codx AI: ${modelName} might work better for ${editor.document.languageId} files.`,
                'Switch',
                'Don\'t ask again'
            ).then(selection => {
                if (selection === 'Switch') {
                    state.currentModel = recommendedModel;
                    context.globalState.update('codx.selectedModel', recommendedModel);
                    updateStatusBarItem(statusBarItem, state);
                    vscode.window.showInformationMessage(`Switched to ${modelName}`);
                } else if (selection === 'Don\'t ask again') {
                    context.globalState.update('codx.disableModelRecommendations', true);
                }
            });
        }
    });

    const checkModelHealth = async () => {
        try {
            const client = getCurrentClient(state);
            await client.invoke([{ role: 'user', content: 'test' }]);
        } catch (error) {
            console.error('Model health check failed:', error);
            vscode.window.showWarningMessage(
                `Codx AI: Current model (${state.models.get(state.currentModel)?.displayName}) may be experiencing issues.`,
                'Switch Model'
            ).then(selection => {
                if (selection === 'Switch Model') {
                    vscode.commands.executeCommand('codx.selectModel');
                }
            });
        }
    };

    const healthCheckInterval = setInterval(checkModelHealth, 30 * 60 * 1000);

    const quickCommands = [
        vscode.commands.registerCommand('codx.quickRefactor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('Please select code to refactor.');
                return;
            }
            vscode.commands.executeCommand('codx.refactorCode');
        }),
        
        vscode.commands.registerCommand('codx.quickExplain', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('Please open a file to explain.');
                return;
            }
            vscode.commands.executeCommand('codx.explainCode');
        }),
        
        vscode.commands.registerCommand('codx.quickFormat', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('Please open a file to format.');
                return;
            }
            vscode.commands.executeCommand('codx.formatCode');
        }),
        
        vscode.commands.registerCommand('codx.quickChat', async () => {
            vscode.commands.executeCommand('codx.openChat');
        })
    ];

    const trackModelUsage = (modelName: string, feature: string) => {
        if (vscode.env.isTelemetryEnabled) {
            console.log(`Codx AI: Used ${modelName} for ${feature}`);
        }
    };

    context.subscriptions.push(
        selectModelCommand,
        completionProvider,
        refactorCommand,
        state.diagnostics,
        explainCommand,
        formatCommand,
        codeActionProvider,
        fixCommand,
        askWithFileContextCommand,
        openChatCommand,
        compareModelsCommand,
        showModelInfoCommand,
        statusBarItem,
        statusBarContextMenu,
        hoverProvider,
        workspaceSymbolProvider,
        activityBarItem,
        ...contextMenuCommands,
        ...quickCommands,
        { dispose: () => clearInterval(healthCheckInterval) }
    );

    validateConfiguration();

    const currentModelName = state.models.get(state.currentModel)?.displayName || state.currentModel;
    vscode.window.showInformationMessage(`Codx AI Assistant is now active! 🤖 Current model: ${currentModelName}`);
}

export function deactivate() {
    console.log('Codx AI Assistant deactivated');
}