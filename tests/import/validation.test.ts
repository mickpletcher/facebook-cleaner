import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatTerminalSummary, writeValidationReport } from "../../src/import/report.js";
import { validateCollection } from "../../src/import/validation.js";

const sanitizedFixture = resolve("tests/fixtures/sanitized-facebook-export");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("collection validation", () => {
  it("returns a sanitized aggregate report", async () => {
    const report = await validateCollection([sanitizedFixture]);
    const serialized = JSON.stringify(report);

    expect(report.status).toBe("completed");
    expect(report.summary.recordsExamined).toBe(3);
    expect(report.summary.parsedRecords).toBe(3);
    expect(report.summary.fingerprintedRecords).toBe(3);
    expect(report.sourceFiles).toHaveLength(1);
    expect(serialized).not.toContain(sanitizedFixture);
    expect(serialized).not.toContain("Sanitized text post");
  });

  it("writes valid JSON atomically", async () => {
    const report = await validateCollection([sanitizedFixture]);
    const directory = mkdtempSync(join(tmpdir(), "facebook-cleaner-report-test-"));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, "validation.json");

    writeValidationReport(reportPath, report);
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toEqual(report);
  });

  it("formats a terminal summary without private values", async () => {
    const report = await validateCollection([sanitizedFixture]);
    const summary = formatTerminalSummary(report);

    expect(summary).toContain("Records examined: 3");
    expect(summary).not.toContain(sanitizedFixture);
    expect(summary).not.toContain("Sanitized text post");
  });

  it("runs through the PowerShell wrapper in a path containing an ampersand", () => {
    const scriptPath = resolve("scripts/Invoke-FacebookInventoryImport.ps1");
    const output = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        scriptPath,
        "-ExportPath",
        sanitizedFixture,
        "-ValidateOnly",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );

    expect(output).toContain("Records examined: 3");
    expect(output).not.toContain("Sanitized text post");
  });
});
