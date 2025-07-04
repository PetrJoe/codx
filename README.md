# Codx AI Code Assistant

A Visual Studio Code extension that integrates Mistral AI's Codestral model for advanced coding assistance, including:

- **Auto-complete code**: Intelligent code completions as you type.
- **Code suggestions**: Inline suggestions to improve your code.
- **Code refactoring**: Refactor selected code for better readability and efficiency.
- **Chat with code file**: Interact with your code through a chat interface.
- **Mention and chat with files**: Reference specific files using `#file` in the chat.

## Prerequisites

- Visual Studio Code (version 1.99.0 or higher)
- Node.js (version 18 or higher)
- Mistral AI API key (get it from [Mistral AI's La Plateforme](https://console.mistral.ai/))

## Installation

1. **Clone the repository** or create a new VS Code extension project:
   ```bash
   npx --package yo --package generator-code -- yo code
   ```
   Select "New Extension (TypeScript)" and configure as needed.

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Mistral AI API key**:
   - Open VS Code settings (`Cmd + ,` or `Ctrl + ,`).
   - Search for `codx.apiKey`.
   - Enter your Mistral AI API key.

4. **Compile the extension**:
   ```bash
   npm run compile
   ```

5. **Run the extension**:
   - Press `F5` in VS Code to launch the extension in a new window.

## Usage

- **Auto-complete code**: Start typing, and completions will appear. Press `Tab` to accept.
- **Code suggestions**: Select code, and hover over the lightbulb (💡) for suggestions.
- **Code refactoring**: Select code, then run the `Codx AI: Refactor Code` command from the Command Palette (`Cmd + Shift + P` or `Ctrl + Shift + P`).
- **Chat with code**: Open the Chat view (`Ctrl + Alt + I`), type `@codeChat` followed by your query.
- **Mention files**: In the Chat view, use `#file:path/to/file` to include file context in your query.

## Example Chat Queries

- `@codeChat Explain the function in #file:src/index.js`
- `@codeChat How can I optimize this code? #file:src/app.ts`
- `@codeChat Write a new feature for my app`

## Notes

- Ensure your Mistral AI API key is valid and has access to the Codestral model.
- The extension uses the `codestral-latest` model for code-related tasks.
- For large codebases, be specific in chat prompts to improve response relevance.

## Troubleshooting

- **API key issues**: Verify your API key in VS Code settings.
- **No completions**: Ensure the Codestral model is accessible and your API key has sufficient quota.
- **Chat not responding**: Check your internet connection and Mistral AI API status.

## License

MIT License
