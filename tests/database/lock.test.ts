import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatabaseInstanceLock,
  getLockPath,
  inspectDatabaseLock,
} from "../../src/database/lock.js";

const temporaryDirectories: string[] = [];

function createTemporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "facebook-cleaner-lock-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "inventory.db");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database instance lock", () => {
  it("creates and releases its adjacent lock file", () => {
    const databasePath = createTemporaryDatabasePath();
    const lock = DatabaseInstanceLock.acquire(databasePath);

    expect(inspectDatabaseLock(databasePath)?.status).toBe("active");
    lock.release();
    expect(inspectDatabaseLock(databasePath)).toBeNull();
  });

  it("identifies a stale local lock without removing it", () => {
    const databasePath = createTemporaryDatabasePath();
    writeFileSync(
      getLockPath(databasePath),
      JSON.stringify({
        token: "stale-token",
        pid: 2_147_483_647,
        computerName: hostname(),
        applicationStartedAtUtc: "2026-07-21T00:00:00.000Z",
        databasePath,
      }),
      "utf8",
    );

    expect(inspectDatabaseLock(databasePath)?.status).toBe("stale");
    expect(() => DatabaseInstanceLock.acquire(databasePath)).toThrow(
      "Database lock already exists with status: stale",
    );
    expect(inspectDatabaseLock(databasePath)?.status).toBe("stale");
  });

  it("treats malformed lock content as invalid", () => {
    const databasePath = createTemporaryDatabasePath();
    writeFileSync(getLockPath(databasePath), "not-json", "utf8");

    expect(inspectDatabaseLock(databasePath)?.status).toBe("invalid");
  });
});
