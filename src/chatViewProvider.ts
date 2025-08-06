import * as vscode from 'vscode';
import { CodebaseHandler } from './codebaseHandler';
import { LLMService } from './llmService';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp?: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'llmCodeAssistant.chatView';
    
    private _view?: vscode.WebviewView;
    private _messages: ChatMessage[] = [];
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _codebaseHandler: CodebaseHandler,
        private readonly _llmService: LLMService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this._handleUserMessage(data.message);
                    break;
                case 'clearChat':
                    this._clearChat();
                    break;
                case 'getStats':
                    await this._sendCodebaseStats();
                    break;
            }
        });

        // Send initial stats
        this._sendCodebaseStats();
    }

    private async _handleUserMessage(message: string) {
        if (!message.trim()) return;

        // Add user message
        const userMessage: ChatMessage = {
            role: 'user',
            content: message,
            timestamp: Date.now()
        };
        this._messages.push(userMessage);

        // Update UI with user message
        this._view?.webview.postMessage({
            type: 'addMessage',
            message: userMessage
        });

        // Show typing indicator
        this._view?.webview.postMessage({
            type: 'showTyping'
        });

        try {
            // Create context for the query
            const context = await this._createContext(message);
            
            // Prepare messages for LLM
            const systemPrompt = this._llmService.getSystemPrompt(context);
            const llmMessages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...this._messages.slice(-10) // Keep last 10 messages for context
            ];

            // Manage context window
            const config = vscode.workspace.getConfiguration('llmCodeAssistant');
            const model = config.get<string>('model', 'llama-3.1-8b-instant');
            const modelInfo = this._llmService.getModelInfo(model);
            const maxContextTokens = Math.floor(modelInfo.context * 0.7); // Reserve 30% for response

            const managedMessages = this._llmService.manageContextWindow(llmMessages, maxContextTokens);

            // Generate response
            const response = await this._llmService.generateResponse(managedMessages);

            // Add assistant message
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };
            this._messages.push(assistantMessage);

            // Update UI with assistant message
            this._view?.webview.postMessage({
                type: 'addMessage',
                message: assistantMessage
            });

        } catch (error) {
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
                timestamp: Date.now()
            };
            this._messages.push(errorMessage);

            this._view?.webview.postMessage({
                type: 'addMessage',
                message: errorMessage
            });
        } finally {
            // Hide typing indicator
            this._view?.webview.postMessage({
                type: 'hideTyping'
            });
        }
    }

    private async _createContext(query: string): Promise<string> {
        try {
            const stats = await this._codebaseHandler.getCodebaseStats();
            if (stats.totalFiles === 0) {
                return '';
            }

            const contextParts: string[] = [];

            // Add codebase overview
            contextParts.push(`**Codebase Overview:**
- Total Files: ${stats.totalFiles.toLocaleString()}
- Total Lines: ${stats.totalLines.toLocaleString()}
- Total Tokens: ${stats.totalTokens.toLocaleString()}
- File Types: ${Object.entries(stats.fileTypes).map(([type, count]) => `${type}(${count})`).join(', ')}
- Extensions: ${Object.entries(stats.extensions).slice(0, 10).map(([ext, count]) => `${ext}(${count})`).join(', ')}`);

            // Get relevant files
            const relevantFiles = await this._codebaseHandler.getRelevantFiles(query, 8000);
            if (relevantFiles.length > 0) {
                contextParts.push(`\n**Relevant Files:**`);
                relevantFiles.slice(0, 8).forEach(file => {
                    contextParts.push(`- ${file.filePath} (${file.fileType}, ${file.tokens.toLocaleString()} tokens)`);
                });
            }

            return contextParts.join('\n');
        } catch (error) {
            console.error('Error creating context:', error);
            return '';
        }
    }

    private _clearChat() {
        this._messages = [];
        this._view?.webview.postMessage({
            type: 'clearMessages'
        });
    }

    private async _sendCodebaseStats() {
        try {
            const stats = await this._codebaseHandler.getCodebaseStats();
            this._view?.webview.postMessage({
                type: 'updateStats',
                stats
            });
        } catch (error) {
            console.error('Error getting codebase stats:', error);
        }
    }

    public refreshChat() {
        this._sendCodebaseStats();
    }

    public updateConfiguration() {
        // Refresh the webview when configuration changes
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('llmCodeAssistant');
        const model = config.get<string>('model', 'llama-3.1-8b-instant');
        const modelInfo = this._llmService.getModelInfo(model);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>LLM Code Assistant</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    margin: 0;
                    padding: 10px;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                
                .header {
                    background: linear-gradient(135deg, var(--vscode-button-background), var(--vscode-button-hoverBackground));
                    color: var(--vscode-button-foreground);
                    padding: 10px;
                    border-radius: 8px;
                    margin-bottom: 10px;
                    text-align: center;
                }
                
                .stats {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 8px;
                    border-radius: 6px;
                    margin-bottom: 10px;
                    font-size: 0.9em;
                }
                
                .stats-row {
                    display: flex;
                    justify-content: space-between;
                    margin: 2px 0;
                }
                
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 10px;
                    margin-bottom: 10px;
                    background-color: var(--vscode-editor-background);
                }
                
                .message {
                    margin: 10px 0;
                    padding: 8px 12px;
                    border-radius: 6px;
                    max-width: 85%;
                }
                
                .user-message {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    margin-left: auto;
                    text-align: right;
                }
                
                .assistant-message {
                    background-color: var(--vscode-editor-selectionBackground);
                    border-left: 3px solid var(--vscode-button-background);
                }
                
                .timestamp {
                    font-size: 0.8em;
                    opacity: 0.7;
                    margin-top: 4px;
                }
                
                .input-container {
                    display: flex;
                    gap: 8px;
                    align-items: flex-end;
                }
                
                .input-wrapper {
                    flex: 1;
                    position: relative;
                }
                
                textarea {
                    width: 100%;
                    min-height: 60px;
                    max-height: 120px;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-family: inherit;
                    font-size: inherit;
                    resize: vertical;
                    box-sizing: border-box;
                }
                
                textarea:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
                
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-family: inherit;
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                
                .clear-btn {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    font-size: 0.9em;
                    padding: 6px 12px;
                }
                
                .typing-indicator {
                    display: none;
                    padding: 8px 12px;
                    font-style: italic;
                    opacity: 0.7;
                }
                
                .typing-indicator.show {
                    display: block;
                }
                
                pre {
                    background-color: var(--vscode-textCodeBlock-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 8px;
                    overflow-x: auto;
                    margin: 8px 0;
                }
                
                code {
                    font-family: var(--vscode-editor-font-family);
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 2px;
                }
                
                .model-info {
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                    text-align: center;
                    margin-bottom: 8px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h3>LLM Code Assistant</h3>
                <div class="model-info">Using: ${modelInfo.name} (${modelInfo.context.toLocaleString()} tokens)</div>
            </div>
            
            <div class="stats" id="stats">
                <div class="stats-row">
                    <span>Files:</span>
                    <span id="files-count">0</span>
                </div>
                <div class="stats-row">
                    <span>Lines:</span>
                    <span id="lines-count">0</span>
                </div>
                <div class="stats-row">
                    <span>Tokens:</span>
                    <span id="tokens-count">0</span>
                </div>
            </div>
            
            <div class="chat-container" id="chat-container">
                <div class="assistant-message">
                    <div>👋 Hello! I'm your LLM Code Assistant. I can help you with:</div>
                    <ul>
                        <li>Code generation and review</li>
                        <li>Codebase analysis and navigation</li>
                        <li>Bug fixes and optimizations</li>
                        <li>Documentation and explanations</li>
                        <li>Best practices and architecture advice</li>
                    </ul>
                    <div>Upload files or process your workspace to get started!</div>
                </div>
                <div class="typing-indicator" id="typing-indicator">
                    🤔 Thinking...
                </div>
            </div>
            
            <div class="input-container">
                <div class="input-wrapper">
                    <textarea 
                        id="message-input" 
                        placeholder="Ask about your code, request features, or get help with programming..."
                        rows="2"
                    ></textarea>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <button id="send-btn">Send</button>
                    <button id="clear-btn" class="clear-btn">Clear</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chat-container');
                const messageInput = document.getElementById('message-input');
                const sendBtn = document.getElementById('send-btn');
                const clearBtn = document.getElementById('clear-btn');
                const typingIndicator = document.getElementById('typing-indicator');
                
                // Handle sending messages
                function sendMessage() {
                    const message = messageInput.value.trim();
                    if (!message) return;
                    
                    vscode.postMessage({
                        type: 'sendMessage',
                        message: message
                    });
                    
                    messageInput.value = '';
                    messageInput.style.height = 'auto';
                }
                
                // Event listeners
                sendBtn.addEventListener('click', sendMessage);
                clearBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'clearChat' });
                });
                
                messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                    }
                });
                
                // Auto-resize textarea
                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    messageInput.style.height = messageInput.scrollHeight + 'px';
                });
                
                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'addMessage':
                            addMessage(message.message);
                            break;
                        case 'clearMessages':
                            clearMessages();
                            break;
                        case 'updateStats':
                            updateStats(message.stats);
                            break;
                        case 'showTyping':
                            showTyping();
                            break;
                        case 'hideTyping':
                            hideTyping();
                            break;
                    }
                });
                
                function addMessage(msg) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = \`message \${msg.role}-message\`;
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.innerHTML = formatMessage(msg.content);
                    messageDiv.appendChild(contentDiv);
                    
                    if (msg.timestamp) {
                        const timestampDiv = document.createElement('div');
                        timestampDiv.className = 'timestamp';
                        timestampDiv.textContent = new Date(msg.timestamp).toLocaleTimeString();
                        messageDiv.appendChild(timestampDiv);
                    }
                    
                    chatContainer.insertBefore(messageDiv, typingIndicator);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                function formatMessage(content) {
                    // Basic markdown-like formatting
                    return content
                        .replace(/\`\`\`([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
                        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/\\n/g, '<br>');
                }
                
                function clearMessages() {
                    const messages = chatContainer.querySelectorAll('.message');
                    messages.forEach(msg => {
                        if (!msg.querySelector('ul')) { // Keep welcome message
                            msg.remove();
                        }
                    });
                }
                
                function updateStats(stats) {
                    document.getElementById('files-count').textContent = stats.totalFiles.toLocaleString();
                    document.getElementById('lines-count').textContent = stats.totalLines.toLocaleString();
                    document.getElementById('tokens-count').textContent = stats.totalTokens.toLocaleString();
                }
                
                function showTyping() {
                    typingIndicator.classList.add('show');
                    sendBtn.disabled = true;
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                function hideTyping() {
                    typingIndicator.classList.remove('show');
                    sendBtn.disabled = false;
                }
                
                // Initial stats request
                vscode.postMessage({ type: 'getStats' });
            </script>
        </body>
        </html>`;
        
    }
}
