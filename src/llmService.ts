import * as vscode from 'vscode';
import axios from 'axios';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface GroqResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

export class LLMService {
    private readonly groqApiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    
    private readonly groqModels = {
        'llama-3.1-8b-instant': { name: 'Llama 3.1 8B (Fastest)', context: 128000 },
        'llama-3.1-70b-versatile': { name: 'Llama 3.1 70B (Most Capable)', context: 128000 },
        'llama-3.2-1b-preview': { name: 'Llama 3.2 1B (Preview)', context: 128000 },
        'llama-3.2-3b-preview': { name: 'Llama 3.2 3B (Preview)', context: 128000 },
        'mixtral-8x7b-32768': { name: 'Mixtral 8x7B', context: 32000 },
        'gemma2-9b-it': { name: 'Gemma 2 9B', context: 8000 }
    };

    async generateResponse(messages: ChatMessage[]): Promise<string> {
        const config = vscode.workspace.getConfiguration('llmCodeAssistant');
        const apiKey = config.get<string>('groqApiKey');
        
        if (!apiKey) {
            throw new Error('Groq API key not configured. Please set it in VS Code settings.');
        }

        const model = config.get<string>('model', 'llama-3.1-8b-instant');
        const temperature = config.get<number>('temperature', 0.1);
        const maxTokens = config.get<number>('maxTokens', 4000);

        try {
            const response = await axios.post<GroqResponse>(
                this.groqApiUrl,
                {
                    model,
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: false
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid API key. Please check your Groq API key in settings.');
                } else if (error.response?.status === 429) {
                    throw new Error('Rate limit exceeded. Please wait a moment and try again.');
                } else if (error.response?.status === 500) {
                    throw new Error('Groq API server error. Please try again later.');
                } else {
                    throw new Error(`API request failed: ${error.response?.data?.error?.message || error.message}`);
                }
            }
            throw new Error(`Unexpected error: ${error}`);
        }
    }

    getSystemPrompt(codebaseContext?: string): string {
        const basePrompt = `You are CodeMaster AI, an expert programming assistant integrated into VS Code, specializing in large codebase analysis and code generation.

**Core Capabilities:**
1. **Code Generation**: Write clean, efficient, well-documented code
2. **Multi-language Support**: Expert in Python, JavaScript, Java, C++, Go, Rust, and more
3. **Large Codebase Analysis**: Understand complex project structures and relationships
4. **Smart Code Search**: Find relevant code sections using semantic understanding
5. **Optimization**: Suggest performance and architectural improvements
6. **Documentation**: Generate comprehensive explanations and comments
7. **VS Code Integration**: Provide contextual assistance within the editor

**Response Guidelines:**
- Always specify programming language for code blocks using markdown code fences
- Provide context-aware suggestions based on the loaded codebase
- Reference specific files and functions when relevant
- Explain complex logic with clear comments
- Suggest best practices and optimizations
- Keep responses focused and actionable
- When suggesting code changes, provide clear before/after examples

**Code Quality Standards:**
- Production-ready code with proper error handling
- Follow language-specific conventions and best practices
- Optimize for readability, maintainability, and performance
- Include relevant tests and documentation when appropriate

Focus on delivering accurate, contextual solutions for development projects within VS Code.`;

        if (codebaseContext) {
            return `${basePrompt}\n\n**Current Codebase Context:**\n${codebaseContext}`;
        }

        return basePrompt;
    }

    estimateTokens(text: string): number {
        // Simple token estimation (roughly 4 characters per token)
        return Math.ceil(text.length / 4);
    }

    manageContextWindow(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
        if (messages.length === 0) return messages;

        let totalTokens = 0;
        const keptMessages: ChatMessage[] = [];
        
        // Always keep system message if present
        const systemMessage = messages.find(m => m.role === 'system');
        if (systemMessage) {
            totalTokens += this.estimateTokens(systemMessage.content);
            keptMessages.push(systemMessage);
        }

        // Keep recent messages within token limit
        const nonSystemMessages = messages.filter(m => m.role !== 'system');
        for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
            const message = nonSystemMessages[i];
            const messageTokens = this.estimateTokens(message.content);
            
            if (totalTokens + messageTokens <= maxTokens) {
                keptMessages.unshift(message);
                totalTokens += messageTokens;
            } else {
                break;
            }
        }

        // Ensure we have the system message first if it exists
        if (systemMessage && keptMessages[0]?.role !== 'system') {
            const nonSystemKept = keptMessages.filter(m => m.role !== 'system');
            return [systemMessage, ...nonSystemKept];
        }

        return keptMessages;
    }

    getModelInfo(modelKey: string) {
        return this.groqModels[modelKey as keyof typeof this.groqModels] || this.groqModels['llama-3.1-8b-instant'];
    }
}
