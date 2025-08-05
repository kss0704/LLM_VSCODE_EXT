import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { Database, RunResult } from 'sqlite3';
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

export class CodebaseHandler {
  private db: Database;
  private encoding: any;
  private excludedDirs = ['node_modules', 'out', '.git', '.vscode'];

  constructor(private storagePath: string) {
    const dbPath = path.join(this.storagePath, 'codebase.db');
    this.db = new Database(dbPath);
    try {
      this.encoding = encoding_for_model('gpt-3.5-turbo');
    } catch {
      this.encoding = null;
    }
  }

  async initialize() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE,
        file_hash TEXT,
        extension TEXT,
        tokens INTEGER,
        content_preview TEXT,
        processed BOOLEAN DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER,
        chunk_index INTEGER,
        content TEXT,
        tokens INTEGER,
        start_line INTEGER,
        end_line INTEGER,
        chunk_type TEXT,
        FOREIGN KEY (file_id) REFERENCES files(id)
      )`
    ];

    for (const sql of statements) {
      await new Promise<void>((resolve, reject) => {
        this.db.run(sql, err => (err ? reject(err) : resolve()));
      });
    }
  }

  async clearDatabase() {
    await new Promise<void>((resolve, reject) => {
      this.db.run('DELETE FROM files', err => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      this.db.run('DELETE FROM chunks', err => (err ? reject(err) : resolve()));
    });
  }

  async addFile(filePath: string, content: string): Promise<void> {
    const fileHash = crypto.createHash('md5').update(content).digest('hex');
    const extension = path.extname(filePath);
    const tokens = this.countTokens(content);
    const preview = content.slice(0, 1000);

    await new Promise<void>((resolve, reject) => {
      this.db.run(
        `INSERT OR IGNORE INTO files (file_path, file_hash, extension, tokens, content_preview, processed)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [filePath, fileHash, extension, tokens, preview],
        err => (err ? reject(err) : resolve())
      );
    });
  }

  async addChunks(filePath: string, content: string): Promise<void> {
    const fileRow: any = await new Promise((resolve, reject) => {
      this.db.get(
        'SELECT id FROM files WHERE file_path = ?',
        [filePath],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
    if (!fileRow) return;

    const fileId = fileRow.id;
    const lines = content.split('\n');
    let chunkLines: string[] = [];
    let chunkTokens = 0;
    let startLine = 0;
    let chunkIndex = 0;

    const pushChunk = async () => {
      const chunkContent = chunkLines.join('\n');
      const tokens = this.countTokens(chunkContent);
      const endLine = startLine + chunkLines.length - 1;
      await new Promise<void>((resolve, reject) => {
        this.db.run(
          `INSERT INTO chunks (file_id, chunk_index, content, tokens, start_line, end_line, chunk_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [fileId, chunkIndex++, chunkContent, tokens, startLine, endLine, 'general'],
          err => (err ? reject(err) : resolve())
        );
      });
      startLine = endLine + 1;
      chunkLines = [];
      chunkTokens = 0;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTokens = this.countTokens(line);
      if (chunkTokens + lineTokens > 2000) {
        await pushChunk();
      }
      chunkLines.push(line);
      chunkTokens += lineTokens;
    }
    if (chunkLines.length) await pushChunk();

    await new Promise<void>((resolve, reject) => {
      this.db.run('UPDATE files SET processed = 1 WHERE id = ?', [fileId], err => (err ? reject(err) : resolve()));
    });
  }

  async processDirectory(dir: string): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (this.excludedDirs.some(excluded => fullPath.includes(excluded))) {
        continue; // Skip excluded directories
      }

      if (entry.isDirectory()) {
        await this.processDirectory(fullPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath, 'utf8');
        await this.addFile(fullPath, content);
        await this.addChunks(fullPath, content);
      }
    }
  }

  private countTokens(text: string): number {
    if (!this.encoding) return Math.ceil(text.length / 4);
    return this.encoding.encode(text).length;
  }
}
