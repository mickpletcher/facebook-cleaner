import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const migrationNamePattern = /^(\d+)-[a-z0-9-]+\.sql$/;

interface Migration {
  version: number;
  name: string;
  sql: string;
  sha256: string;
}

function readMigrations(migrationsDirectory: string): Migration[] {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && migrationNamePattern.test(entry.name))
    .map((entry) => {
      const match = migrationNamePattern.exec(entry.name);
      if (!match?.[1]) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }

      const sql = readFileSync(join(migrationsDirectory, entry.name), "utf8");
      return {
        version: Number.parseInt(match[1], 10),
        name: basename(entry.name),
        sql,
        sha256: createHash("sha256").update(sql, "utf8").digest("hex"),
      };
    })
    .sort((left, right) => left.version - right.version);
}

export function applyMigrations(
  database: DatabaseSync,
  migrationsDirectory: string,
): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      applied_at_utc TEXT NOT NULL
    ) STRICT;
  `);

  const migrations = readMigrations(migrationsDirectory);
  const duplicateVersion = migrations.find(
    (migration, index) =>
      index > 0 && migration.version === migrations[index - 1]?.version,
  );
  if (duplicateVersion) {
    throw new Error(`Duplicate migration version: ${duplicateVersion.version}`);
  }

  const appliedMigrations = new Map(
    database
      .prepare("SELECT version, name, sha256 FROM schema_migrations")
      .all()
      .map((row) => [
        Number(row.version),
        { name: String(row.name), sha256: String(row.sha256) },
      ]),
  );

  const insertMigration = database.prepare(`
    INSERT INTO schema_migrations(version, name, sha256, applied_at_utc)
    VALUES (?, ?, ?, ?)
  `);

  let appliedCount = 0;
  for (const migration of migrations) {
    const applied = appliedMigrations.get(migration.version);
    if (applied) {
      if (applied.name !== migration.name || applied.sha256 !== migration.sha256) {
        throw new Error(
          `Applied migration ${migration.version} does not match ${migration.name}`,
        );
      }
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insertMigration.run(
        migration.version,
        migration.name,
        migration.sha256,
        new Date().toISOString(),
      );
      database.exec("COMMIT");
      appliedCount += 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return appliedCount;
}
