## 💡 Usage Examples

### Code Generation
**User:** "Create a Python function to calculate fibonacci numbers with memoization"

**Assistant:** 
```python
def fibonacci_memo(n, memo={}):
    """
    Calculate fibonacci number using memoization for optimization.
    
    Args:
        n (int): The position in fibonacci sequence
        memo (dict): Memoization cache
        
    Returns:
        int: The fibonacci number at position n
    """
    if n in memo:
        return memo[n]
    
    if n <= 1:
        return n
    
    memo[n] = fibonacci_memo(n-1, memo) + fibonacci_memo(n-2, memo)
    return memo[n]

# Usage example
print(fibonacci_memo(10))  # Output: 55
```

### Codebase Analysis
**User:** "What design patterns are used in this codebase?"

**Assistant:** "Based on your codebase analysis, I can see several design patterns:

1. **Factory Pattern** - Used in `src/handlers/` for creating different file processors
2. **Observer Pattern** - Implemented in `src/events/` for handling file change notifications  
3. **Singleton Pattern** - Database connection manager in `src/database/connection.ts`
4. **Strategy Pattern** - Different chunking strategies in `codebaseHandler.ts`

The codebase follows clean architecture principles with clear separation of concerns."

### Bug Detection
**User:** "Find potential issues in my authentication code"

**Assistant:** "I found several potential security issues in your authentication implementation:

1. **Password Storage** - Passwords should be hashed with bcrypt
2. **SQL Injection** - Use parameterized queries in `login.js:45`
3. **JWT Secret** - Hard-coded secret should be in environment variables
4. **Rate Limiting** - Missing rate limiting on login attempts

Here's a secure implementation:
```javascript
// Secure password hashing
const bcrypt = require('bcrypt');
const saltRounds = 12;

async function hashPassword(password) {
    return await bcrypt.hash(password, saltRounds);
}
```"

### Code Optimization
**User:** "How can I optimize this React component for better performance?"

**Assistant:** "Based on your component code, here are optimization suggestions:

1. **Memoization**: Use `React.memo()` for expensive renders
2. **useCallback**: Wrap event handlers to prevent unnecessary re-renders
3. **useMemo**: Cache expensive calculations
4. **Code Splitting**: Use `React.lazy()` for dynamic imports

Here's the optimized version:
```jsx
import React, { memo, useCallback, useMemo } from 'react';

const OptimizedComponent = memo(({ data, onUpdate }) => {
    const processedData = useMemo(() => {
        return data.filter(item => item.active).sort((a, b) => a.name.localeCompare(b.name));
    }, [data]);

    const handleClick = useCallback((id) => {
        onUpdate(id);
    }, [onUpdate]);

    return (
        <div>
            {processedData.map(item => (
                <Item key={item.id} data={item} onClick={handleClick} />
            ))}
        </div>
    );
});
```"

## 🔧 Advanced Configuration

### Custom Chunking Strategies
You can modify the chunking behavior by editing `codebaseHandler.ts`:

```typescript
// Add custom patterns for new languages
const boundaryPatterns: Record<string, RegExp[]> = {
    '.py': [/^\s*(def |class |import |from )/],
    '.js': [/^\s*(function |class |const |let |var )/],
    '.rust': [/^\s*(fn |struct |impl |mod )/], // Custom Rust patterns
    '.scala': [/^\s*(def |class |object |trait )/] // Custom Scala patterns
};
```

### Model-Specific Settings
Configure different settings per model:

```json
{
    "llmCodeAssistant.modelConfigs": {
        "llama-3.1-70b-versatile": {
            "temperature": 0.05,
            "maxTokens": 6000
        },
        "mixtral-8x7b-32768": {
            "temperature": 0.15,
            "maxTokens": 4000
        }
    }
}
```

### Custom File Priorities
Adjust file processing priority:

```typescript
private readonly filePriority: Record<string, number> = {
    '.py': 10,    // Highest priority
    '.js': 9,
    '.ts': 9,
    '.main.py': 15,  // Even higher for main files
    '.config.json': 2 // Lower priority for config
};
```

## 🐛 Troubleshooting

### Common Issues

#### Extension Not Activating
- **Symptom**: Commands not appearing in Command Palette
- **Solution**: Check `activationEvents` in `package.json`
- **Debug**: Open Developer Tools (`Help > Toggle Developer Tools`)

#### SQLite Database Errors
- **Symptom**: "Database locked" or permission errors
- **Solution**: Clear cache via `LLM Assistant: Clear Cache`
- **Alternative**: Manually delete the database file in global storage

#### API Rate Limits
- **Symptom**: "Rate limit exceeded" errors
- **Solution**: 
  - Wait for rate limit reset
  - Use a different model with higher limits
  - Implement request queuing

#### Large File Processing Issues  
- **Symptom**: Out of memory errors or timeouts
- **Solutions**:
  - Increase `maxFileSize` setting
  - Process files in smaller batches
  - Exclude large directories (node_modules, .git)

#### Context Window Exceeded
- **Symptom**: Truncated responses or API errors
- **Solutions**:
  - Use models with larger context windows
  - Reduce the number of files processed
  - Implement smarter context pruning

### Debug Mode
Enable detailed logging:

```json
{
    "llmCodeAssistant.debug": true,
    "llmCodeAssistant.logLevel": "verbose"
}
```

View logs in VS Code Output panel (select "LLM Code Assistant" from dropdown).

## 🏗️ Architecture Overview

### Component Diagram
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Extension     │────│  Chat Provider   │────│   Webview UI    │
│   (main.ts)     │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────┐
│ Codebase        │    │   LLM Service    │
│ Handler         │    │                  │
│                 │    │                  │
└─────────────────┘    └──────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────┐
│   SQLite DB     │    │   Groq API       │
│                 │    │                  │
└─────────────────┘    └──────────────────┘
```

### Data Flow
1. **File Processing**: Files → Chunking → SQLite Storage
2. **Query Processing**: User Query → Context Creation → LLM API
3. **Response**: API Response → Formatting → Webview Display

### Database Schema
```sql
-- Files table
CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    file_path TEXT UNIQUE,
    file_hash TEXT,
    extension TEXT,
    tokens INTEGER,
    priority INTEGER,
    is_processed BOOLEAN
);

-- Chunks table  
CREATE TABLE file_chunks (
    id INTEGER PRIMARY KEY,
    file_id INTEGER,
    content TEXT,
    tokens INTEGER,
    chunk_type TEXT,
    FOREIGN KEY (file_id) REFERENCES files (id)
);
```

## 🚀 Performance Optimization

### Best Practices
1. **Workspace Size**: Limit to <50MB for optimal performance
2. **File Selection**: Process only relevant files for your use case
3. **Model Choice**: Use faster models for quick queries
4. **Context Management**: Clear chat history periodically

### Memory Usage
- **Small Projects** (<100 files): ~50-100MB
- **Medium Projects** (100-1000 files): ~200-500MB  
- **Large Projects** (1000+ files): ~500MB-1GB

### Performance Monitoring
Monitor extension performance:
```javascript
// In Developer Tools Console
console.log(process.memoryUsage());
```

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Clone your fork: `git clone <your-fork>`
3. Install dependencies: `npm install`
4. Make changes in `src/`
5. Test: Press `F5` in VS Code
6. Submit PR

### Code Standards
- **TypeScript**: Strict mode enabled
- **Formatting**: Use VS Code default formatter
- **Testing**: Add tests for new features
- **Documentation**: Update README for new features

### Adding New Features
1. **File Types**: Add to `supportedExtensions` set
2. **Models**: Add to `groqModels` configuration
3. **Commands**: Register in `package.json` and `extension.ts`
4. **Settings**: Add to configuration section in `package.json`

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- **Groq**: For providing excellent LLM API
- **VS Code Team**: For comprehensive extension APIs
- **Community**: For feedback and contributions

## 📞 Support

- **Issues**: GitHub Issues page
- **Discussions**: GitHub Discussions
- **Email**: [Your support email]
- **Discord**: [Your Discord server]

---

**Made with ❤️ for developers who love AI-powered coding assistance**
