import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type LockStatus = "active" | "stale" | "remote" | "invalid";

export interface LockMetadata {
  token: string;
  pid: number;
  computerName: string;
  applicationStartedAtUtc: string;
  databasePath: string;
}

export interface LockInspection {
  status: LockStatus;
  metadata?: LockMetadata;
}

export class DatabaseLockError extends Error {
  readonly inspection: LockInspection;

  constructor(inspection: LockInspection) {
    super(`Database lock already exists with status: ${inspection.status}`);
    this.name = "DatabaseLockError";
    this.inspection = inspection;
  }
}

function isLockMetadata(value: unknown): value is LockMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.token === "string" &&
    typeof record.pid === "number" &&
    typeof record.computerName === "string" &&
    typeof record.applicationStartedAtUtc === "string" &&
    typeof record.databasePath === "string"
  );
}

function localProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

export function getLockPath(databasePath: string): string {
  return `${resolve(databasePath)}.lock`;
}

export function inspectDatabaseLock(databasePath: string): LockInspection | null {
  const lockPath = getLockPath(databasePath);
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!isLockMetadata(parsed)) {
      return { status: "invalid" };
    }

    if (parsed.computerName !== hostname()) {
      return { status: "remote", metadata: parsed };
    }

    return {
      status: localProcessExists(parsed.pid) ? "active" : "stale",
      metadata: parsed,
    };
  } catch {
    return { status: "invalid" };
  }
}

export class DatabaseInstanceLock {
  readonly path: string;
  readonly metadata: LockMetadata;
  #released = false;

  private constructor(path: string, metadata: LockMetadata) {
    this.path = path;
    this.metadata = metadata;
  }

  static acquire(databasePath: string): DatabaseInstanceLock {
    const absoluteDatabasePath = resolve(databasePath);
    const lockPath = getLockPath(absoluteDatabasePath);
    const metadata: LockMetadata = {
      token: randomUUID(),
      pid: process.pid,
      computerName: hostname(),
      applicationStartedAtUtc: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      databasePath: absoluteDatabasePath,
    };

    let descriptor: number;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new DatabaseLockError(
          inspectDatabaseLock(absoluteDatabasePath) ?? { status: "invalid" },
        );
      }
      throw error;
    }

    try {
      writeFileSync(descriptor, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    } catch (error) {
      closeSync(descriptor);
      unlinkSync(lockPath);
      throw error;
    }
    closeSync(descriptor);

    return new DatabaseInstanceLock(lockPath, metadata);
  }

  release(): void {
    if (this.#released) {
      return;
    }

    const inspection = inspectDatabaseLock(this.metadata.databasePath);
    if (inspection?.metadata?.token === this.metadata.token) {
      unlinkSync(this.path);
    }
    this.#released = true;
  }
}
