import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { Database } from 'sqlite3';
import { encoding_for_model } from 'tiktoken';

interface FileInfo {
    filePath: string;
    extension: string;
    fileType: string;
    size: number;
    lines: number;
    tokens: number;
    priority: number;
    hash: string;
    contentPreview: string;
}

interface ChunkInfo {
    content: string;
    tokens: number;
    startLine: number;
    endLine: number;
    chunkType: string;
}

interface CodebaseStats {
    totalFiles: number;
    processedFiles: number;
    totalTokens: number;
    totalLines: number;
    fileTypes: Record<string, number>;
    extensions: Record<string, number>;
}

// Define types for database rows
interface FileRow {
    file_path: string;
    extension: string;
    tokens: number;
    priority: number;
    file_type: string;
    content_preview: string;
    file_hash: string;
}

interface ChunkRow {
    file_id: string;
    content: string;
    tokens: number;
}

interface StatsRow {
    count: number;
    lines: number;
    tokens: number;
}

interface TypeRow {
    file_type: string;
    count: number;
}

interface ExtRow {
    extension: string;
    count: number;
}

export class CodebaseHandler {
    private db: Database;
    private encoding: any;
    private readonly supportedExtensions = new Set([
        '.py', '.js', '.ts', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb',
        '.swift', '.kt', '.html', '.css', '.sql', '.sh', '.yml', '.yaml',
        '.json', '.xml', '.md', '.txt', '.cfg', '.ini', '.toml', '.jsx', '.tsx'
    ]);

    private readonly filePriority: Record<string, number> = {
        '.py': 10, '.js': 9, '.ts': 9, '.java': 8, '.cpp': 7, '.c': 7,
        '.go': 6, '.rs': 6, '.jsx': 8, '.tsx': 8, '.html': 5, '.css': 4,
        '.sql': 6, '.sh': 5, '.yml': 4, '.yaml': 4, '.json': 3, '.xml': 3,
        '.md': 4, '.txt': 3, '.cfg': 2, '.ini': 2
    };

    constructor(storagePath: string) {
        // Ensure storage directory exists
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }

        const dbPath = path.join(storagePath, 'codebase.db');
        this.db = new Database(dbPath);
        
        try {
            this.encoding = encoding_for_model("gpt-3.5-turbo");
        } catch (error) {
            console.warn('Failed to load tiktoken encoding, using fallback');
            this.encoding = null;
        }

        this.initDatabase();
    }

    private initDatabase(): void {
        const statements = [
            `CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE,
                file_hash TEXT,
                extension TEXT,
                file_type TEXT,
                size INTEGER,
                lines INTEGER,
                tokens INTEGER,
                priority INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_modified DATETIME,
                is_processed BOOLEAN DEFAULT FALSE,
                content_preview TEXT
            )`,
            
            `CREATE TABLE IF NOT EXISTS file_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER,
                chunk_index INTEGER,
                content TEXT,
                tokens INTEGER,
                start_line INTEGER,
                end_line INTEGER,
                chunk_type TEXT DEFAULT 'general',
                chunk_hash TEXT,
                FOREIGN KEY (file_id) REFERENCES files (id)
            )`,
            
            `CREATE INDEX IF NOT EXISTS idx_file_path ON files(file_path)`,
            `CREATE INDEX IF NOT EXISTS idx_file_priority ON files(priority DESC, tokens ASC)`,
            `CREATE INDEX IF NOT EXISTS idx_chunk_tokens ON file_chunks(tokens)`
        ];

        statements.forEach(sql => {
            this.db.run(sql, (err) => {
                if (err) console.error('Database error:', err);
            });
        });
    }

    private countTokens(text: string): number {
        if (this.encoding) {
            return this.encoding.encode(text).length;
        }
        return Math.ceil(text.length / 4); // Fallback estimation
    }

    private extractFileContent(filePath: string): string {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content;
        } catch (error) {
            throw new Error(`Failed to read file ${filePath}: ${error}`);
        }
    }

    private smartChunkContent(content: string, extension: string, maxTokens: number = 2000): ChunkInfo[] {
        const lines = content.split('\n');
        const chunks: ChunkInfo[] = [];
        let currentChunk: string[] = [];
        let currentTokens = 0;
        let startLine = 0;

        const boundaryPatterns: Record<string, RegExp[]> = {
            '.py': [/^\s*(def |class |import |from )/, /^\s*#.*/, /^\s*""".*"""/],
            '.js': [/^\s*(function |class |const |let |var )/, /^\s*\/\*.*\*\//, /^\s*\/\/.*/],
            '.ts': [/^\s*(function |class |const |let |var |interface |type )/, /^\s*\/\*.*\*\//, /^\s*\/\/.*/],
            '.java': [/^\s*(public |private |protected |class |interface )/, /^\s*\/\*.*\*\//, /^\s*\/\/.*/],
            '.cpp': [/^\s*(class |struct |namespace |#include)/, /^\s*\/\*.*\*\//, /^\s*\/\/.*/]
        };

        const patterns = boundaryPatterns[extension] || [/^\s*$/];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineTokens = this.countTokens(line);
            
            const isBoundary = patterns.some(pattern => pattern.test(line));
            
            if ((isBoundary && currentTokens > maxTokens * 0.5) || 
                (currentTokens + lineTokens > maxTokens)) {
                
                if (currentChunk.length > 0) {
                    chunks.push({
                        content: currentChunk.join('\n'),
                        tokens: currentTokens,
                        startLine: startLine,
                        endLine: startLine + currentChunk.length - 1,
                        chunkType: this.determineChunkType(currentChunk.join('\n'), extension)
                    });
                }
                
                currentChunk = [line];
                currentTokens = lineTokens;
                startLine = i;
            } else {
                currentChunk.push(line);
                currentTokens += lineTokens;
            }
        }

        if (currentChunk.length > 0) {
            chunks.push({
                content: currentChunk.join('\n'),
                tokens: currentTokens,
                startLine: startLine,
                endLine: startLine + currentChunk.length - 1,
                chunkType: this.determineChunkType(currentChunk.join('\n'), extension)
            });
        }

        return chunks;
    }

    private determineChunkType(content: string, extension: string): string {
        const lowerContent = content.toLowerCase();
        
        if (lowerContent.includes('class ') || lowerContent.includes('function ') || lowerContent.includes('def ')) {
            return 'class_function';
        } else if (lowerContent.includes('import ') || lowerContent.includes('#include') || lowerContent.includes('require(')) {
            return 'imports';
        } else if (content.trim().startsWith('#') || content.trim().startsWith('//') || content.trim().startsWith('/*')) {
            return 'comments';
        } else if (extension === '.md' && content.includes('#')) {
            return 'heading';
        }
        
        return 'general';
    }

    // Fixed: Added missing getAllFiles method
    private getAllFiles(rootPath: string): string[] {
        const files: string[] = [];
        const excludedDirs = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build']);

        const traverse = (currentPath: string) => {
            try {
                const items = fs.readdirSync(currentPath);
                
                for (const item of items) {
                    const fullPath = path.join(currentPath, item);
                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                        if (!excludedDirs.has(item) && !item.startsWith('.')) {
                            traverse(fullPath);
                        }
                    } else if (stat.isFile()) {
                        const extension = path.extname(item).toLowerCase();
                        if (this.supportedExtensions.has(extension)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error reading directory ${currentPath}:`, error);
            }
        };

        traverse(rootPath);
        return files;
    }

    async processFile(filePath: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const self = this; // Store reference to avoid binding issues
            try {
                const extension = path.extname(filePath).toLowerCase();
                
                if (!this.supportedExtensions.has(extension)) {
                    resolve(false);
                    return;
                }

                const stats = fs.statSync(filePath);
                const config = vscode.workspace.getConfiguration('llmCodeAssistant');
                const maxFileSize = config.get('maxFileSize', 10485760); // 10MB default

                if (stats.size > maxFileSize) {
                    console.warn(`File too large: ${filePath} (${stats.size} bytes)`);
                    resolve(false);
                    return;
                }

                const content = this.extractFileContent(filePath);
                const totalTokens = this.countTokens(content);
                
                if (totalTokens > 100000) {
                    console.warn(`File has too many tokens: ${filePath} (${totalTokens} tokens)`);
                    resolve(false);
                    return;
                }

                const fileHash = crypto.createHash('md5').update(content).digest('hex');
                const lines = content.split('\n').length;
                const priority = this.filePriority[extension] || 1;
                const contentPreview = content.substring(0, 500) + (content.length > 500 ? '...' : '');
                
                const fileType = this.determineFileType(extension);

                this.db.run(
                    `INSERT OR REPLACE INTO files 
                     (file_path, file_hash, extension, file_type, size, lines, tokens, priority, 
                      last_modified, is_processed, content_preview)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1, ?)`,
                    [filePath, fileHash, extension, fileType, stats.size, lines, totalTokens, priority, contentPreview],
                    function(this: any, err: Error | null) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        const fileId = this.lastID;
                        
                        // Delete old chunks
                        self.db.run('DELETE FROM file_chunks WHERE file_id = ?', [fileId], (err: Error | null) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            // Create chunks
                            const chunks = self.smartChunkContent(content, extension);
                            let insertedChunks = 0;

                            if (chunks.length === 0) {
                                resolve(true);
                                return;
                            }

                            chunks.forEach((chunk: ChunkInfo, index: number) => {
                                const chunkHash = crypto.createHash('md5').update(chunk.content).digest('hex');
                                
                                self.db.run(
                                    `INSERT INTO file_chunks 
                                     (file_id, chunk_index, content, tokens, start_line, end_line, chunk_type, chunk_hash)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [fileId, index, chunk.content, chunk.tokens, chunk.startLine, chunk.endLine, chunk.chunkType, chunkHash],
                                    (err: Error | null) => {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }

                                        insertedChunks++;
                                        if (insertedChunks === chunks.length) {
                                            resolve(true);
                                        }
                                    }
                                );
                            });
                        });
                    }
                );

            } catch (error) {
                reject(error);
            }
        });
    }

    private determineFileType(extension: string): string {
        const codeExtensions = ['.py', '.js', '.ts', '.java', '.cpp', '.c', '.go', '.rs'];
        const configExtensions = ['.json', '.xml', '.yml', '.yaml', '.cfg', '.ini'];
        const textExtensions = ['.md', '.txt'];

        if (codeExtensions.includes(extension)) return 'code';
        if (configExtensions.includes(extension)) return 'config';
        if (textExtensions.includes(extension)) return 'text';
        return 'other';
    }

    // Fixed: Added missing processWorkspace method
    async processWorkspace(workspacePath: string, progressCallback?: (current: number, total: number) => boolean): Promise<CodebaseStats> {
        const files = this.getAllFiles(workspacePath);
        const stats: CodebaseStats = {
            totalFiles: files.length,
            processedFiles: 0,
            totalTokens: 0,
            totalLines: 0,
            fileTypes: {},
            extensions: {}
        };

        for (let i = 0; i < files.length; i++) {
            if (progressCallback && !progressCallback(i + 1, files.length)) {
                break; // Cancelled
            }

            try {
                const success = await this.processFile(files[i]);
                if (success) {
                    stats.processedFiles++;
                }
            } catch (error) {
                console.error(`Error processing ${files[i]}:`, error);
            }
        }

        // Update stats with actual data from database
        const actualStats = await this.getCodebaseStats();
        return {
            ...stats,
            totalTokens: actualStats.totalTokens,
            totalLines: actualStats.totalLines,
            fileTypes: actualStats.fileTypes,
            extensions: actualStats.extensions
        };
    }

    // Fixed: Added missing getRelevantFiles method
    async getRelevantFiles(query: string, maxTokens: number): Promise<FileInfo[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT file_path, extension, tokens, priority, file_type, content_preview, file_hash
                 FROM files 
                 WHERE is_processed = 1 
                 ORDER BY priority DESC, tokens ASC`,
                (err, rows: FileRow[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const queryKeywords = new Set(query.toLowerCase().split(/\s+/));
                    let currentTokens = 0;
                    const selectedFiles: FileInfo[] = [];

                    for (const row of rows) {
                        if (currentTokens + row.tokens > maxTokens) break;

                        const filename = path.basename(row.file_path).toLowerCase();
                        let relevanceScore = 0;

                        // Calculate relevance
                        queryKeywords.forEach(keyword => {
                            if (filename.includes(keyword)) relevanceScore += 10;
                            if (row.extension.includes(keyword)) relevanceScore += 5;
                            if (row.file_type.includes(keyword)) relevanceScore += 3;
                            if (row.content_preview.toLowerCase().includes(keyword)) relevanceScore += 7;
                        });

                        selectedFiles.push({
                            filePath: row.file_path,
                            extension: row.extension,
                            fileType: row.file_type,
                            size: 0, // Not needed for this use case
                            lines: 0, // Not needed for this use case
                            tokens: row.tokens,
                            priority: row.priority,
                            hash: row.file_hash,
                            contentPreview: row.content_preview
                        });

                        currentTokens += row.tokens;
                    }

                    // Sort by relevance
                    selectedFiles.sort((a, b) => b.priority - a.priority);
                    resolve(selectedFiles.slice(0, 20));
                }
            );
        });
    }

    async getCodebaseStats(): Promise<CodebaseStats> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT COUNT(*) as count, SUM(lines) as lines, SUM(tokens) as tokens FROM files WHERE is_processed = 1',
                (err, row: StatsRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this.db.all(
                        'SELECT file_type, COUNT(*) as count FROM files WHERE is_processed = 1 GROUP BY file_type',
                        (err, typeRows: TypeRow[]) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            this.db.all(
                                'SELECT extension, COUNT(*) as count FROM files WHERE is_processed = 1 GROUP BY extension',
                                (err, extRows: ExtRow[]) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    const fileTypes: Record<string, number> = {};
                                    typeRows.forEach(r => fileTypes[r.file_type] = r.count);

                                    const extensions: Record<string, number> = {};
                                    extRows.forEach(r => extensions[r.extension] = r.count);

                                    resolve({
                                        totalFiles: row.count || 0,
                                        processedFiles: row.count || 0,
                                        totalTokens: row.tokens || 0,
                                        totalLines: row.lines || 0,
                                        fileTypes,
                                        extensions
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    }

    // Fixed: Added missing clearCache method
    async clearCache(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM file_chunks', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.db.run('DELETE FROM files', (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    }
}
