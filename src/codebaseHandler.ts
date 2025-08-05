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
            this.db.run(sql, (err: Error | null) => {
                if (err) console.error('Database error:', err);
            });
        });
    }

    dispose(): void {
        this.db.close((err: Error | null) => {
            if (err) console.error('Error closing database:', err);
        });
    }

    smartChunkContent(content: string, maxTokens: number): ChunkInfo[] {
        const lines = content.split('\n');
        const chunks: ChunkInfo[] = [];
        let currentChunk: string[] = [];
        let currentTokens = 0;
        let startLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const tokenCount = this.encoding ? this.encoding.encode(line).length : Math.ceil(line.length / 4);

            if (currentTokens + tokenCount > maxTokens && currentChunk.length > 0) {
                chunks.push({
                    content: currentChunk.join('\n'),
                    tokens: currentTokens,
                    startLine,
                    endLine: i - 1,
                    chunkType: 'code'
                });
                currentChunk = [];
                currentTokens = 0;
                startLine = i;
            }

            currentChunk.push(line);
            currentTokens += tokenCount;
        }

        if (currentChunk.length > 0) {
            chunks.push({
                content: currentChunk.join('\n'),
                tokens: currentTokens,
                startLine,
                endLine: lines.length - 1,
                chunkType: 'code'
            });
        }

        return chunks;
    }

    getRelevantChunks(filePath: string, maxChunks: number): Promise<ChunkInfo[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT fc.content, fc.tokens, fc.start_line, fc.end_line, fc.chunk_type
                 FROM file_chunks fc
                 JOIN files f ON fc.file_id = f.id
                 WHERE f.file_path = ?
                 ORDER BY fc.tokens ASC
                 LIMIT ?`,
                [filePath, maxChunks],
                (err: Error | null, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const chunks: ChunkInfo[] = rows.map(row => ({
                        content: row.content,
                        tokens: row.tokens,
                        startLine: row.start_line,
                        endLine: row.end_line,
                        chunkType: row.chunk_type
                    }));

                    resolve(chunks);
                }
            );
        });
    }
}
