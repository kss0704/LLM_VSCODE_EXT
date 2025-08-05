import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodebaseHandler } from './codebaseHandler';
import { LLMService } from './llmService';
import { ChatViewProvider } from './chatViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('LLM Code Assistant is now active!');

    // Initialize services
    const codebaseHandler = new CodebaseHandler(context.globalStorageUri.fsPath);
    const llmService = new LLMService();
    const chatProvider = new ChatViewProvider(context.extensionUri, codebaseHandler, llmService);

    // Register chat view
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'llmCodeAssistant.chatView',
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Set activation flag
    vscode.commands.executeCommand('setContext', 'llmCodeAssistant.activated', true);

    // Register commands
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
        })
    ];

    context.subscriptions.push(...commands);

    // Auto-process workspace if enabled
    const config = vscode.workspace.getConfiguration('llmCodeAssistant');
    if (config.get('autoProcessWorkspace', false)) {
        vscode.commands.executeCommand('llmCodeAssistant.processWorkspace');
    }

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('llmCodeAssistant')) {
                chatProvider.updateConfiguration();
            }
        })
    );

    // Watch for file changes
    context.subscriptions.push(
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

export function deactivate() {
    console.log('LLM Code Assistant deactivated');
}
