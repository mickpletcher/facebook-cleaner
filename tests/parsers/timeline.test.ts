import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateTimelineFile } from "../../src/parsers/timeline.js";
import type { DiscoveredSourceFile } from "../../src/import/types.js";

const temporaryDirectories: string[] = [];

function sourceFor(path: string): DiscoveredSourceFile {
  const content = readFileSync(path);
  return {
    absolutePath: path,
    exportRootNumber: 1,
    relativePath:
      "your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json",
    sequence: 1,
    sizeBytes: statSync(path).size,
    sha256: createHash("sha256").update(content).digest("hex"),
    sourceKind: "timeline",
  };
}

function createTimelineFile(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "facebook-cleaner-parser-test-"));
  temporaryDirectories.push(root);
  const directory = join(root, "your_facebook_activity", "posts");
  mkdirSync(directory, { recursive: true });
  const path = join(
    directory,
    "your_posts__check_ins__photos_and_videos_1.json",
  );
  writeFileSync(path, content, "utf8");
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("validateTimelineFile", () => {
  it("streams the sanitized fixture", async () => {
    const path = resolve(
      "tests/fixtures/sanitized-facebook-export/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json",
    );

    const result = await validateTimelineFile(sourceFor(path));
    expect(result).toMatchObject({
      status: "completed",
      recordsExamined: 3,
      parsedRecords: 3,
      fingerprintedRecords: 3,
      partialRecords: 0,
      unsupportedRecords: 0,
      earliestTimestamp: 1_704_067_200,
      latestTimestamp: 1_704_240_000,
    });
  });

  it("reports partial and unsupported records without printing content", async () => {
    const path = createTimelineFile(
      JSON.stringify([
        null,
        { data: [{ post: "PRIVATE_SENTINEL" }] },
        { timestamp: 1, data: [{ post: "PRIVATE_SENTINEL" }] },
      ]),
    );

    const result = await validateTimelineFile(sourceFor(path));
    expect(result.status).toBe("completed_with_errors");
    expect(result.recordsExamined).toBe(3);
    expect(result.parsedRecords).toBe(1);
    expect(result.fingerprintedRecords).toBe(1);
    expect(result.partialRecords).toBe(1);
    expect(result.unsupportedRecords).toBe(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
  });

  it("reports malformed JSON safely", async () => {
    const path = createTimelineFile('[{"timestamp":1},');

    const result = await validateTimelineFile(sourceFor(path));
    expect(result.status).toBe("failed");
    expect(result.errors.at(-1)?.code).toBe("JSON_INVALID");
  });

  it("rejects a non-array root", async () => {
    const path = createTimelineFile('{"timestamp":1}');

    const result = await validateTimelineFile(sourceFor(path));
    expect(result.status).toBe("failed");
    expect(result.errors[0]?.code).toBe("RECORD_UNSUPPORTED");
  });

  it("processes a large array incrementally", async () => {
    const records = Array.from({ length: 10_000 }, (_, index) =>
      JSON.stringify({ timestamp: index + 1 }),
    );
    const path = createTimelineFile(`[${records.join(",")}]`);

    const result = await validateTimelineFile(sourceFor(path));
    expect(result.status).toBe("completed");
    expect(result.recordsExamined).toBe(10_000);
    expect(result.parsedRecords).toBe(10_000);
    expect(result.fingerprintedRecords).toBe(10_000);
  });

  it("limits retained error details while preserving the total", async () => {
    const path = createTimelineFile(JSON.stringify(Array(150).fill(null)));

    const result = await validateTimelineFile(sourceFor(path));
    expect(result.errorCount).toBe(150);
    expect(result.errors).toHaveLength(100);
    expect(result.errorsTruncated).toBe(true);
  });
});
