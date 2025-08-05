# Change Log

All notable changes to the "LLM Code Assistant" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-XX

### Added
- Initial release of LLM Code Assistant for VS Code
- Interactive chat interface integrated into VS Code sidebar
- Support for multiple Groq LLM models (Llama 3.1, Mixtral, Gemma)
- Smart codebase analysis and processing
- Semantic code chunking for better context understanding
- SQLite-based caching system for efficient file processing
- Support for 20+ programming languages and file types
- Context-aware responses based on processed codebase
- Real-time codebase statistics display
- Command palette integration with key commands:
  - Open Chat
  - Analyze Current File
  - Process Workspace
  - Clear Cache
- Right-click context menus for quick file analysis
- Configurable settings through VS Code preferences
- Token management and context window optimization
- Priority-based file selection algorithm
- Robust error handling and user feedback
- Progress tracking for workspace processing
- Dark/light theme support matching VS Code theme

### Features
- **Multi-language Support**: Python, JavaScript, TypeScript, Java, C++, Go, Rust, PHP, Ruby, Swift, Kotlin, HTML, CSS, SQL, Shell scripts, YAML, JSON, XML, Markdown
- **Smart Context Creation**: Automatically includes relevant files based on query analysis
- **Efficient Processing**: Intelligent file prioritization and chunking strategies
- **Real-time Chat**: Interactive conversations with immediate responses
- **Codebase Insights**: Statistics and analysis of processed files
- **Flexible Configuration**: Customizable model selection, temperature, and token limits

### Technical Details
- Built with TypeScript for type safety and maintainability
- Uses SQLite for efficient local data storage
- Integrates with Groq API for LLM capabilities
- Implements VS Code WebView API for rich UI
- Token counting with tiktoken for accurate context management
- Semantic file chunking respecting code structure

### Requirements
- VS Code 1.74.0 or higher
- Groq API key (free tier available)
- Node.js environment for extension development

## [Unreleased]

### Planned Features
- Code execution capabilities within VS Code
- Integration with more LLM providers (OpenAI, Anthropic)
- Advanced semantic search with embeddings
- Code review and suggestion features
- Team collaboration features
- Plugin system for custom processors
- Support for more document types (PDF, Word, etc.)
- Inline code suggestions
- Git integration for commit message generation
- Workspace-specific model configurations
