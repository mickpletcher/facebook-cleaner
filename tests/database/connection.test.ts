import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InventoryDatabase } from "../../src/database/connection.js";
import { DatabaseLockError } from "../../src/database/lock.js";

const migrationsDirectory = resolve("migrations");
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "facebook-cleaner-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createTemporaryDatabasePath(): string {
  return join(createTemporaryDirectory(), "inventory.db");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("InventoryDatabase", () => {
  it("applies the initial migration and required SQLite settings", () => {
    const inventory = InventoryDatabase.open({
      databasePath: createTemporaryDatabasePath(),
      migrationsDirectory,
    });

    try {
      expect(inventory.migrationsApplied).toBe(1);

      const tables = inventory.database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all()
        .map((row) => row.name);

      expect(tables).toEqual(
        expect.arrayContaining([
          "collection_sets",
          "import_errors",
          "import_runs",
          "media",
          "post_links",
          "post_media",
          "post_observations",
          "post_state_observations",
          "posts",
          "profiles",
          "schema_metadata",
          "schema_migrations",
          "source_files",
          "source_records",
        ]),
      );

      expect(
        inventory.database.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      ).toBe(1);
      expect(
        inventory.database.prepare("PRAGMA journal_mode").get()?.journal_mode,
      ).toBe("delete");
      expect(
        inventory.database.prepare("PRAGMA synchronous").get()?.synchronous,
      ).toBe(2);
      expect(
        inventory.database.prepare("PRAGMA busy_timeout").get()?.timeout,
      ).toBe(5000);
      expect(
        inventory.database.prepare("PRAGMA integrity_check").get()
          ?.integrity_check,
      ).toBe("ok");

      const metadata = new Map(
        inventory.database
          .prepare("SELECT key, value FROM schema_metadata")
          .all()
          .map((row) => [String(row.key), String(row.value)]),
      );
      expect(metadata.get("schema_version")).toBe("1");
      expect(metadata.get("identity_version")).toBe("1");
      expect(metadata.get("application_version")).toBe("0.1.0");
      expect(metadata.get("created_at_utc")).toBeTruthy();
    } finally {
      inventory.close();
    }
  });

  it("does not reapply an existing migration", () => {
    const databasePath = createTemporaryDatabasePath();
    const first = InventoryDatabase.open({ databasePath, migrationsDirectory });
    first.close();

    const second = InventoryDatabase.open({ databasePath, migrationsDirectory });
    try {
      expect(second.migrationsApplied).toBe(0);
      expect(
        second.database
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
          .get()?.count,
      ).toBe(1);
    } finally {
      second.close();
    }
  });

  it("rejects changes to an already applied migration", () => {
    const databasePath = createTemporaryDatabasePath();
    const copiedMigrationsDirectory = join(createTemporaryDirectory(), "migrations");
    mkdirSync(copiedMigrationsDirectory, { recursive: true });
    const copiedMigration = join(
      copiedMigrationsDirectory,
      "001-initial-schema.sql",
    );
    copyFileSync(join(migrationsDirectory, "001-initial-schema.sql"), copiedMigration);

    const first = InventoryDatabase.open({
      databasePath,
      migrationsDirectory: copiedMigrationsDirectory,
    });
    first.close();
    appendFileSync(copiedMigration, "\n-- unexpected change\n", "utf8");

    expect(() =>
      InventoryDatabase.open({
        databasePath,
        migrationsDirectory: copiedMigrationsDirectory,
      }),
    ).toThrow("Applied migration 1 does not match 001-initial-schema.sql");
  });

  it("enforces foreign keys and post constraints", () => {
    const inventory = InventoryDatabase.open({
      databasePath: createTemporaryDatabasePath(),
      migrationsDirectory,
    });

    try {
      expect(() =>
        inventory.database
          .prepare(`
            INSERT INTO collection_sets(
              collection_set_id,
              profile_id,
              source_fingerprint,
              root_count,
              registered_at_utc
            ) VALUES (?, ?, ?, ?, ?)
          `)
          .run("collection-1", "missing-profile", "hash", 1, "2026-07-21T00:00:00.000Z"),
      ).toThrow();

      inventory.database
        .prepare(`
          INSERT INTO profiles(profile_id, created_at_utc)
          VALUES (?, ?)
        `)
        .run("profile-1", "2026-07-21T00:00:00.000Z");

      expect(() =>
        inventory.database
          .prepare(`
            INSERT INTO posts(
              record_id,
              profile_id,
              created_timestamp,
              created_at_utc,
              post_type,
              audience,
              audience_status,
              facebook_state,
              state_status,
              semantic_fingerprint,
              occurrence_slot,
              identity_version,
              collection_status,
              first_collected_at_utc,
              last_collected_at_utc
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            "record-1",
            "profile-1",
            1,
            "1970-01-01T00:00:01.000Z",
            "text",
            "unknown",
            "unavailable",
            "unknown",
            "unknown",
            "fingerprint",
            0,
            1,
            "partial",
            "2026-07-21T00:00:00.000Z",
            "2026-07-21T00:00:00.000Z",
          ),
      ).toThrow();
    } finally {
      inventory.close();
    }
  });

  it("rejects a second writer while the first instance owns the lock", () => {
    const databasePath = createTemporaryDatabasePath();
    const first = InventoryDatabase.open({ databasePath, migrationsDirectory });

    try {
      expect(() =>
        InventoryDatabase.open({ databasePath, migrationsDirectory }),
      ).toThrowError(DatabaseLockError);
    } finally {
      first.close();
    }
  });
});
