import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(".");

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", path], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("repository privacy protections", () => {
  it.each([
    "facebook-private-export/private.json",
    "data/facebook-inventory.db",
    "exports/private/posts.json",
    "reports/import-report.json",
    "last-import-report.json",
    "validation-report.json",
    "private-import-report.json",
    "private-validation-report.json",
    "tests/fixtures/private/post.json",
    "private-photo.jpg",
    "private-photo.jpeg",
    "private-photo.png",
    "private-photo.webp",
    "private-photo.heic",
    "private-photo.tiff",
    "private-video.mp4",
    "private-video.mov",
    "private-video.webm",
    "private-audio.mp3",
    "private-audio.m4a",
    "private-audio.wav",
    "local.sqlite",
    "local.sqlite-wal",
    "local.db-shm",
    "local.db.lock",
  ])("ignores %s", (path) => {
    expect(isIgnored(path)).toBe(true);
  });
});
