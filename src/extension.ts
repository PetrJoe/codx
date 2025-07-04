import * as vscode from 'vscode';
import { Mistral } from '@mistralai/mistralai';
import { v4 as uuidv4 } from 'uuid';

// Extension activation function
export function activate(context: vscode.ExtensionContext) {
    // Initialize Mistral AI client
    const apiKey = vscode.workspace.getConfiguration('codx').get('apiKey', '');
    if (!apiKey) {
        vscode.window.showErrorMessage('Mistral AI API key is not configured. Please set it in VS Code settings.');
        return;
    }
    const client = new Mistral({ apiKey });

    // 1. Auto-complete code and code suggestions using Language Model API
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: '*' },
        {
            async provideCompletionItems(document, position, token, context) {
                const text = document.getText();
                const prefix = document.getText(new vscode.Range(
                    new vscode.Position(0, 0),
                    position
                ));

                try {
                    const response = await client.chat.complete({
                        model: 'codestral-latest',
                        messages: [{ role: 'user', content: `Provide code completion for:\n${prefix}` }],
                        max_tokens: 100,
                    });

                    const completionText = response.choices[0].message.content;
                    const completionItem = new vscode.CompletionItem(completionText, vscode.CompletionItemKind.Snippet);
                    completionItem.range = new vscode.Range(position, position);
                    return [completionItem];
                } catch (error) {
                    vscode.window.showErrorMessage(`Error in code completion: ${error.message}`);
                    return [];
                }
            }
        },
        '.' // Trigger completion on dot
    );

    // 2. Code suggestions as inline annotations
    const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ' 💡',
            color: '#888888',
            fontStyle: 'italic'
        }
    });

    async function provideCodeSuggestions(editor: vscode.TextEditor) {
        const document = editor.document;
        const selection = editor.selection;
        const text = document.getText(selection);

        if (text.length > 0) {
            try {
                const response = await client.chat.complete({
                    model: 'codestral-latest',
                    messages: [{ role: 'user', content: `Suggest improvements for this code:\n${text}` }],
                    max_tokens: 200,
                });

                const suggestion = response.choices[0].message.content;
                const decoration = {
                    range: selection,
                    hoverMessage: new vscode.MarkdownString(`**Suggestion**: ${suggestion}`)
                };
                editor.setDecorations(decorationType, [decoration]);
            } catch (error) {
                vscode.window.showErrorMessage(`Error in code suggestion: ${error.message}`);
            }
        }
    }

    // Update suggestions on text selection
    vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.selections.length > 0 && !e.selections[0].isEmpty) {
            provideCodeSuggestions(e.textEditor);
        } else {
            e.textEditor.setDecorations(decorationType, []);
        }
    });

    // 3. Code refactoring command
    const refactorCommand = vscode.commands.registerCommand('codx.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const text = document.getText(selection);

        if (!text) {
            vscode.window.showErrorMessage('Please select code to refactor.');
            return;
        }

        try {
            const response = await client.chat.complete({
                model: 'codestral-latest',
                messages: [{ role: 'user', content: `Refactor this code to improve readability and efficiency:\n${text}` }],
                max_tokens: 500,
            });

            const refactoredCode = response.choices[0].message.content;
            editor.edit((editBuilder) => {
                editBuilder.replace(selection, refactoredCode);
            });
            vscode.window.showInformationMessage('Code refactored successfully!');
        } catch (error) {
            vscode.window.showErrorMessage(`Error in code refactoring: ${error.message}`);
        }
    });

    // 4 & 5. Chat with code file and mention files using Chat Participant API
    const chatParticipant = vscode.chat.createChatParticipant('codx.codeChat', async (request, context, stream, position) => {
        const messages = [];
        let fileContext = '';

        // Handle file mentions (e.g., #file:src/index.js)
        for (const ref of request.references || []) {
            if (ref.kind === 'file') {
                const uri = ref.value;
                const document = await vscode.workspace.openTextDocument(uri);
                fileContext += `File: ${uri.fsPath}\n${document.getText()}\n\n`;
            }
        }

        // Build prompt with file context and user message
        const prompt = fileContext
            ? `You are a coding assistant. Use the following file context to answer the query:\n${fileContext}\nUser query: ${request.prompt}`
            : `You are a coding assistant. Answer the query: ${request.prompt}`;

        messages.push({ role: 'user', content: prompt });

        try {
            const response = await client.chat.complete({
                model: 'codestral-latest',
                messages,
                max_tokens: 1000,
            });

            stream.markdown(response.choices[0].message.content);
        } catch (error) {
            stream.markdown(`Error: ${error.message}`);
        }
    });

    chatParticipant.name = 'codeChat';
    chatParticipant.fullName = 'Codx AI Code Chat';
    chatParticipant.description = 'Chat about your code or mention files with #file';
    chatParticipant.isSticky = true;

    // Register disposables
    context.subscriptions.push(completionProvider, refactorCommand, chatParticipant);
}

// Extension deactivation function
export function deactivate() {
    // Clean up resources if needed
}
