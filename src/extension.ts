import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodebaseHandler } from './codebaseHandler';
import { LLMService } from './llmService';
import { ChatViewProvider } from './chatViewProvider';
import { spawn, ChildProcess } from 'child_process';

let streamlitProcess: ChildProcess | null = null;
let streamlitPanel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('LLM Code Assistant is now active!');

    const codebaseHandler = new CodebaseHandler(context.globalStorageUri.fsPath);
    const llmService = new LLMService();
    const chatProvider = new ChatViewProvider(context.extensionUri, codebaseHandler, llmService);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'llmCodeAssistant.chatView',
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    vscode.commands.executeCommand('setContext', 'llmCodeAssistant.activated', true);

    const commands = [
        vscode.commands.registerCommand('llmCodeAssistant.chat', () => {
            vscode.commands.executeCommand('workbench.view.extension.llm-code-assistant');
        }),

        vscode.commands.registerCommand('llmCodeAssistant.analyzeFile', async (uri?: vscode.Uri) => {
            const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!fileUri) {
                vscode.window.showErrorMessage('No file selected');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Analyzing file...",
                cancellable: false
            }, async () => {
                try {
                    await codebaseHandler.processFile(fileUri.fsPath);
                    vscode.window.showInformationMessage(`File analyzed: ${path.basename(fileUri.fsPath)}`);
                    chatProvider.refreshChat();
                } catch (error) {
                    vscode.window.showErrorMessage(`Error analyzing file: ${error}`);
                }
            });
        }),

        vscode.commands.registerCommand('llmCodeAssistant.processWorkspace', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const folder = workspaceFolders[0];

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Processing workspace...",
                cancellable: true
            }, async (progress, token) => {
                try {
                    const stats = await codebaseHandler.processWorkspace(folder.uri.fsPath, (current, total) => {
                        progress.report({
                            increment: (1 / total) * 100,
                            message: `Processing file ${current}/${total}`
                        });
                        return !token.isCancellationRequested;
                    });

                    if (!token.isCancellationRequested) {
                        vscode.window.showInformationMessage(
                            `Workspace processed: ${stats.processedFiles}/${stats.totalFiles} files`
                        );
                        chatProvider.refreshChat();
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error processing workspace: ${error}`);
                }
            });
        }),

        vscode.commands.registerCommand('llmCodeAssistant.clearCache', async () => {
            const result = await vscode.window.showWarningMessage(
                'This will clear all processed codebase data. Continue?',
                'Yes', 'No'
            );

            if (result === 'Yes') {
                await codebaseHandler.clearCache();
                vscode.window.showInformationMessage('Cache cleared successfully');
                chatProvider.refreshChat();
            }
        }),

        // Updated Streamlit command to embed in VS Code
        vscode.commands.registerCommand('llmCodeAssistant.launchStreamlitApp', () => {
            createEmbeddedStreamlitPanel(context);
        })
    ];

    context.subscriptions.push(...commands);

    // Cleanup on deactivate
    context.subscriptions.push(new vscode.Disposable(() => {
        if (streamlitProcess) {
            streamlitProcess.kill();
            streamlitProcess = null;
        }
    }));

    const config = vscode.workspace.getConfiguration('llmCodeAssistant');
    if (config.get('autoProcessWorkspace', false)) {
        vscode.commands.executeCommand('llmCodeAssistant.processWorkspace');
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('llmCodeAssistant')) {
                chatProvider.updateConfiguration();
            }
        }),

        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration('llmCodeAssistant');
            if (config.get('autoProcessOnSave', false)) {
                try {
                    await codebaseHandler.processFile(document.uri.fsPath);
                    chatProvider.refreshChat();
                } catch (error) {
                    console.error('Error auto-processing saved file:', error);
                }
            }
        })
    );
}

function createEmbeddedStreamlitPanel(context: vscode.ExtensionContext) {
    // If panel already exists, show it
    if (streamlitPanel) {
        streamlitPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    // Create webview panel
    streamlitPanel = vscode.window.createWebviewPanel(
        'streamlitApp',
        'LLM Code Assistant - Streamlit App',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'python'))]
        }
    );

    // Start Streamlit process
    startEmbeddedStreamlitProcess(context);

    // Set initial HTML content with loading message
    streamlitPanel.webview.html = getLoadingHtml();

    // Wait for Streamlit to start, then load the app
    setTimeout(() => {
        if (streamlitPanel) {
            streamlitPanel.webview.html = getStreamlitEmbedHtml();
        }
    }, 4000); // Increased wait time for stability

    // Handle panel disposal
    streamlitPanel.onDidDispose(() => {
        streamlitPanel = null;
        if (streamlitProcess) {
            console.log('Terminating Streamlit process...');
            streamlitProcess.kill('SIGTERM');
            streamlitProcess = null;
        }
    }, null, context.subscriptions);
}

function startEmbeddedStreamlitProcess(context: vscode.ExtensionContext) {
    if (streamlitProcess) {
        return; // Already running
    }

    const pythonPath = path.join(context.extensionPath, 'python');
    const appPath = path.join(pythonPath, 'app.py');

    // Check if the Streamlit app exists
    if (!fs.existsSync(appPath)) {
        vscode.window.showErrorMessage(`Streamlit app not found at: ${appPath}`);
        return;
    }

    console.log(`Starting Streamlit app from: ${appPath}`);

    // Start Streamlit with specific configuration for embedding
    streamlitProcess = spawn('streamlit', [
        'run',
        appPath,
        '--server.port=8522', // Use a different port to avoid conflicts
        '--server.headless=true',
        '--server.enableCORS=false',
        '--server.enableXsrfProtection=false',
        '--browser.gatherUsageStats=false',
        '--global.developmentMode=false',
        '--server.allowRunOnSave=false'
    ], {
        cwd: pythonPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
    });

    streamlitProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log(`Streamlit stdout: ${output}`);
        
        // Look for the "You can now view your Streamlit app" message
        if (output.includes('You can now view your Streamlit app')) {
            console.log('Streamlit app is ready!');
        }
    });

    streamlitProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        console.error(`Streamlit stderr: ${error}`);
        
        // Handle common errors
        if (error.includes('Address already in use')) {
            vscode.window.showWarningMessage('Port 8522 is already in use. Trying to connect to existing instance...');
        }
    });

    streamlitProcess.on('close', (code) => {
        console.log(`Streamlit process exited with code ${code}`);
        streamlitProcess = null;
        if (code !== 0 && streamlitPanel) {
            streamlitPanel.webview.html = getErrorHtml(`Streamlit process exited with code ${code}`);
        }
    });

    streamlitProcess.on('error', (error) => {
        console.error('Failed to start Streamlit process:', error);
        vscode.window.showErrorMessage(`Failed to start Streamlit: ${error.message}. Make sure Streamlit is installed (pip install streamlit)`);
        if (streamlitPanel) {
            streamlitPanel.webview.html = getErrorHtml(`Failed to start Streamlit: ${error.message}`);
        }
    });
}

function getLoadingHtml(): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Loading LLM Code Assistant</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .loading-container {
                    text-align: center;
                    max-width: 400px;
                    padding: 2rem;
                }
                .spinner {
                    border: 4px solid var(--vscode-progressBar-background);
                    border-top: 4px solid var(--vscode-progressBar-foreground);
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 1.5rem;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .loading-text {
                    font-size: 1.2rem;
                    margin-bottom: 1rem;
                }
                .loading-details {
                    font-size: 0.9rem;
                    opacity: 0.8;
                    line-height: 1.4;
                }
            </style>
        </head>
        <body>
            <div class="loading-container">
                <div class="spinner"></div>
                <div class="loading-text">🚀 Starting LLM Code Assistant</div>
                <div class="loading-details">
                    Initializing Streamlit application...<br>
                    This may take a few seconds.
                </div>
            </div>
        </body>
        </html>
    `;
}

function getStreamlitEmbedHtml(): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>LLM Code Assistant</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    overflow: hidden;
                    background-color: var(--vscode-editor-background);
                }
                iframe {
                    width: 100%;
                    height: 100vh;
                    border: none;
                    background-color: white;
                }
                .error-container {
                    padding: 2rem;
                    text-align: center;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    box-sizing: border-box;
                }
                .retry-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 3px;
                    cursor: pointer;
                    margin-top: 1rem;
                    font-size: 0.9rem;
                }
                .retry-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <iframe 
                id="streamlitFrame"
                src="http://localhost:8522"
                sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
                onload="handleLoad()"
                onerror="handleError()">
            </iframe>
            
            <script>
                let retryCount = 0;
                const maxRetries = 15;
                let retryInterval;
                
                function handleLoad() {
                    console.log('Streamlit app loaded successfully');
                    clearInterval(retryInterval);
                }
                
                function handleError() {
                    console.log('Error loading Streamlit app, retrying...', retryCount);
                    if (retryCount < maxRetries) {
                        retryCount++;
                        setTimeout(() => {
                            const iframe = document.getElementById('streamlitFrame');
                            iframe.src = 'http://localhost:8522?' + new Date().getTime(); // Add cache buster
                        }, 2000);
                    } else {
                        showError();
                    }
                }
                
                function showError() {
                    document.body.innerHTML = \`
                        <div class="error-container">
                            <h2>🔧 Unable to Load Streamlit App</h2>
                            <p>The Streamlit application failed to start or is not responding.</p>
                            <div style="margin: 1rem 0; font-size: 0.9rem; opacity: 0.8;">
                                <strong>Troubleshooting steps:</strong><br>
                                1. Ensure Streamlit is installed: <code>pip install streamlit</code><br>
                                2. Check that your Python environment is active<br>
                                3. Verify the app.py file exists in the python/ folder<br>
                                4. Try closing and reopening the panel
                            </div>
                            <button class="retry-button" onclick="retryConnection()">🔄 Retry Connection</button>
                        </div>
                    \`;
                }
                
                function retryConnection() {
                    retryCount = 0;
                    document.body.innerHTML = \`
                        <iframe 
                            id="streamlitFrame"
                            src="http://localhost:8522"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
                            onload="handleLoad()"
                            onerror="handleError()">
                        </iframe>
                    \`;
                }
                
                // Progressive retry mechanism
                retryInterval = setInterval(() => {
                    const iframe = document.getElementById('streamlitFrame');
                    if (iframe && retryCount < 5) {
                        try {
                            // Test if iframe is accessible
                            if (!iframe.contentWindow || iframe.contentWindow.location.href === 'about:blank') {
                                retryCount++;
                                iframe.src = 'http://localhost:8522?' + new Date().getTime();
                            } else {
                                clearInterval(retryInterval);
                            }
                        } catch (e) {
                            // Cross-origin restrictions, but iframe might still be working
                            clearInterval(retryInterval);
                        }
                    } else if (retryCount >= 5) {
                        clearInterval(retryInterval);
                    }
                }, 3000);
                
                // Clean up interval when page unloads
                window.addEventListener('beforeunload', () => {
                    clearInterval(retryInterval);
                });
            </script>
        </body>
        </html>
    `;
}

function getErrorHtml(errorMessage: string): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Streamlit Error</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    padding: 2rem;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    line-height: 1.6;
                }
                .error-container {
                    max-width: 600px;
                    margin: 0 auto;
                    text-align: center;
                }
                .error-message {
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    padding: 1rem;
                    border-radius: 4px;
                    margin: 1rem 0;
                    font-family: monospace;
                    font-size: 0.9rem;
                    text-align: left;
                }
            </style>
        </head>
        <body>
            <div class="error-container">
                <h2>❌ Streamlit Application Error</h2>
                <div class="error-message">${errorMessage}</div>
                <p>Please check the VS Code console for more details.</p>
            </div>
        </body>
        </html>
    `;
}

export function deactivate() {
    console.log('LLM Code Assistant deactivated');
    if (streamlitProcess) {
        streamlitProcess.kill('SIGTERM');
        streamlitProcess = null;
    }
}
