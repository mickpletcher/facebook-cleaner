import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DatabaseInstanceLock } from "./lock.js";
import { applyMigrations } from "./migrations.js";

export interface OpenInventoryDatabaseOptions {
  databasePath: string;
  migrationsDirectory: string;
}

export class InventoryDatabase implements Disposable {
  readonly path: string;
  readonly database: DatabaseSync;
  readonly migrationsApplied: number;
  readonly #lock: DatabaseInstanceLock;
  #closed = false;

  private constructor(
    path: string,
    database: DatabaseSync,
    lock: DatabaseInstanceLock,
    migrationsApplied: number,
  ) {
    this.path = path;
    this.database = database;
    this.#lock = lock;
    this.migrationsApplied = migrationsApplied;
  }

  static open(options: OpenInventoryDatabaseOptions): InventoryDatabase {
    const databasePath = resolve(options.databasePath);
    const migrationsDirectory = resolve(options.migrationsDirectory);
    mkdirSync(dirname(databasePath), { recursive: true });

    const lock = DatabaseInstanceLock.acquire(databasePath);
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, {
        allowExtension: false,
        defensive: true,
        enableDoubleQuotedStringLiterals: false,
        enableForeignKeyConstraints: true,
        timeout: 5_000,
      });
      database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
      `);
      const migrationsApplied = applyMigrations(database, migrationsDirectory);
      return new InventoryDatabase(
        databasePath,
        database,
        lock,
        migrationsApplied,
      );
    } catch (error) {
      database?.close();
      lock.release();
      throw error;
    }
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    try {
      this.database.close();
    } finally {
      this.#lock.release();
      this.#closed = true;
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
