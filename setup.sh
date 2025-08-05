#!/bin/bash

# LLM Code Assistant VS Code Extension Setup Script

echo "🚀 Setting up LLM Code Assistant VS Code Extension..."

# Create project structure
echo "📁 Creating project structure..."
mkdir -p llm-code-assistant/{src,.vscode}
cd llm-code-assistant

# Initialize npm project
echo "📦 Initializing npm project..."
npm init -y

# Install dependencies
echo "⬇️ Installing dependencies..."
npm install --save-dev @types/vscode@^1.74.0 @types/node@16.x typescript@^4.9.4
npm install axios@^1.6.0 sqlite3@^5.1.6 tiktoken@^1.0.10

# Update package.json scripts
echo "📝 Updating package.json scripts..."
npm pkg set scripts.vscode:prepublish="npm run compile"
npm pkg set scripts.compile="tsc -p ./"
npm pkg set scripts.watch="tsc -watch -p ./"

# Create directory structure
echo "📂 Setting up directory structure..."
mkdir -p src .vscode out

echo "✅ Project structure created!"
echo ""
echo "📋 Next steps:"
echo "1. Copy the TypeScript files to src/ directory:"
echo "   - extension.ts"
echo "   - codebaseHandler.ts" 
echo "   - llmService.ts"
echo "   - chatViewProvider.ts"
echo ""
echo "2. Copy configuration files:"
echo "   - package.json (update with provided content)"
echo "   - tsconfig.json"
echo "   - .vscode/launch.json"
echo "   - .vscode/tasks.json"
echo ""
echo "3. Compile and test:"
echo "   npm run compile"
echo "   code . (then press F5 to test)"
echo ""
echo "4. Set up your Groq API key in VS Code settings"
echo ""
echo "🎉 Setup complete! Happy coding!"
