# Codx AI Code Assistant

A powerful Visual Studio Code extension that integrates Mistral AI's Codestral model for comprehensive coding assistance.

## 🚀 Features


### ✨ **Auto-Complete Code**
- Intelligent code completions as you type
- Context-aware suggestions based on your current code
- Supports all programming languages

### 💡 **Smart Code Suggestions**
- Real-time inline suggestions with lightbulb (💡) indicators
- Hover over suggestions to see AI recommendations
- Automatic suggestions when you select code

### 🔧 **Code Refactoring**
- AI-powered code refactoring for better readability and efficiency
- Select code and use `Ctrl+Alt+R` (or `Cmd+Alt+R` on Mac)
- Available via Command Palette: "Codx AI: Refactor Code"

### 📚 **Code Explanations**
- Get detailed explanations of your code
- Works with selected code or entire files
- Use `Ctrl+Alt+E` (or `Cmd+Alt+E` on Mac)
- Opens in a dedicated explanation panel

### 🎨 **Code Formatting**
- AI-enhanced code formatting and cleanup
- Use `Ctrl+Alt+F` (or `Cmd+Alt+F` on Mac)
- Works with selections or entire files

### 💬 **Interactive Chat Panel**
- Full-featured AI chat interface
- Use `Ctrl+Alt+I` (or `Cmd+Alt+I` on Mac)
- Ask coding questions, get help with debugging
- Persistent chat history during session

### 🔍 **Smart Diagnostics**
- Real-time code analysis and issue detection
- AI-powered error and warning detection
- Automatic suggestions for fixes

### ⚡ **Quick Fix Actions**
- AI-powered quick fixes for detected issues
- Right-click context menu integration
- Automatic code improvements

### 📁 **File Context Analysis**
- Analyze multiple files together
- Ask questions about your entire codebase
- Command: "Codx AI: Ask with File Context"

### 🎯 **Context Menu Integration**
- Right-click any code for AI options:
  - 🤖 Refactor with AI
  - 🤖 Explain with AI  
  - 🤖 Format with AI

## 📋 Prerequisites

- **Visual Studio Code** (version 1.99.0 or higher)
- **Node.js** (version 18 or higher)
- **Mistral AI API key** - Get it from [Mistral AI Console](https://console.mistral.ai/)

## 🛠️ Installation

### Method 1: From Source
1. **Clone the repository**:
   ```bash
   git clone https://github.com/PetrJoe/codx.git
   cd codx
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Compile the extension**:
   ```bash
   npm run compile
   ```

4. **Run the extension**:
   - Press `F5` in VS Code to launch in a new Extension Development Host window

### Method 2: Package and Install
1. **Install vsce** (if not already installed):
   ```bash
   npm install -g vsce
   ```

2. **Package the extension**:
   ```bash
   vsce package
   ```

3. **Install the .vsix file**:
   - In VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
   - Select the generated `.vsix` file

4. Install the created .vsix file with:
  ```bash
   code --install-extension codx.vsix
  ```

## ⚙️ Configuration

1. **Open VS Code Settings** (`Ctrl+,` or `Cmd+,`)
2. **Search for "codx"**
3. **Configure the following settings**:

### Required Settings
- **`codx.apiKey`**: Your Mistral AI API key (required)

### Optional Settings
- **`codx.model`**: AI model to use (default: "codestral-latest")
  - Options: `codestral-latest`, `codestral-2405`, `mistral-large-latest`
- **`codx.temperature`**: Response creativity (0-1, default: 0.7)
  - 0 = More deterministic, 1 = More creative

## 🎮 Usage

### Keyboard Shortcuts
- **`Ctrl+Alt+I`** (`Cmd+Alt+I`): Open AI Chat
- **`Ctrl+Alt+R`** (`Cmd+Alt+R`): Refactor Code
- **`Ctrl+Alt+E`** (`Cmd+Alt+E`): Explain Code
- **`Ctrl+Alt+F`** (`Cmd+Alt+F`): Format Code

### Command Palette
Press `Ctrl+Shift+P` (`Cmd+Shift+P`) and search for:
- `Codx AI: Open AI Chat`
- `Codx AI: Refactor Code`
- `Codx AI: Explain Code`
- `Codx AI: Format Code`
- `Codx AI: Ask with File Context`

### Context Menu
Right-click on any code to access:
- 🤖 Refactor with AI
- 🤖 Explain with AI
- 🤖 Format with AI

### Status Bar
- Click the "🤖 Codx AI" status bar item to open the chat panel

## 🔧 Troubleshooting

### Common Issues

**❌ "MistralAI API key is not configured"**
- Solution: Set your API key in VS Code settings (`codx.apiKey`)

**❌ "Failed to generate code completion"**
- Check your internet connection
- Verify your API key is valid and has sufficient quota
- Ensure the Codestral model is accessible

**❌ Chat not responding**
- Check your internet connection
- Verify Mistral AI API status
- Try refreshing the chat panel

**❌ No completions appearing**
- Ensure the extension is activated (check status bar)
- Try typing in a supported file type
- Check VS Code's IntelliSense settings

### Debug Mode
1. Open VS Code Developer Tools (`Help` → `Toggle Developer Tools`)
2. Check the Console tab for error messages
3. Look for "Codx" or "Mistral" related errors

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Mistral AI](https://mistral.ai/) for providing the Codestral model
- [LangChain](https://langchain.com/) for the integration framework
- The VS Code team for the excellent extension API

---

**Made with ❤️ by the Codx team**

*Happy coding with AI! 🤖✨*
