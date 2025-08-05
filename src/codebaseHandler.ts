import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as sqlite3 from 'sqlite3';
import { TokenTextSplitter } from './utils/tokenSplitter';

const readFileAsync = promisify(fs.readFile);

export class CodebaseHandler {
    private db: sqlite3.Database;
    private splitter: TokenTextSplitter;

    constructor(dbPath: string) {
        this.db = new sqlite3.Database(dbPath);
        this.splitter = new TokenTextSplitter();
        this.initializeDatabase();
    }

    private initializeDatabase() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT UNIQUE,
                content TEXT
            );
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS file_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER,
                chunk_index INTEGER,
                content TEXT,
                FOREIGN KEY(file_id) REFERENCES files(id)
            );
        `);
    }

    private async readFileContent(filePath: string): Promise<string> {
        return await readFileAsync(filePath, 'utf-8');
    }

    private async storeFileContent(filePath: string, content: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR IGNORE INTO files (filepath, content) VALUES (?, ?)`,
                [filePath, content],
                function (this: sqlite3.RunResult, err: Error | null) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID ?? 0);
                    }
                }
            );
        });
    }

    private smartChunkContent(content: string, extension: string): string[] {
        return this.splitter.smartSplit(content, extension);
    }

    public async processFile(filePath: string): Promise<void> {
        const content = await this.readFileContent(filePath);
        const extension = path.extname(filePath);

        this.db.get(`SELECT id FROM files WHERE filepath = ?`, [filePath], (err: Error | null, row: any) => {
            if (err) {
                console.error('Failed to retrieve file ID:', err);
                return;
            }

            const fileId = row?.id;
            const chunks = this.smartChunkContent(content, extension);

            const insertChunks = (id: number) => {
                chunks.forEach((chunk: string, index: number) => {
                    this.db.run(
                        `INSERT INTO file_chunks (file_id, chunk_index, content) VALUES (?, ?, ?)`,
                        [id, index, chunk],
                        (err: Error | null) => {
                            if (err) {
                                console.error('Failed to insert chunk:', err);
                            }
                        }
                    );
                });
            };

            if (!fileId) {
                this.storeFileContent(filePath, content)
                    .then((newFileId) => {
                        insertChunks(newFileId);
                    })
                    .catch((error) => console.error('Store file failed:', error));
            } else {
                this.db.run('DELETE FROM file_chunks WHERE file_id = ?', [fileId], (delErr: Error | null) => {
                    if (delErr) {
                        console.error('Failed to delete old chunks:', delErr);
                        return;
                    }
                    insertChunks(fileId);
                });
            }
        });
    }
}
