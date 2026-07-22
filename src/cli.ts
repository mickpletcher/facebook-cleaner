import { parseArgs } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatImportTerminalSummary,
  formatTerminalSummary,
  writeJsonReport,
  writeValidationReport,
} from "./import/report.js";
import { importTimelineCollection } from "./import/importer.js";
import { validateCollection } from "./import/validation.js";

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        "export-path": { type: "string", multiple: true },
        "database-path": { type: "string" },
        "report-path": { type: "string" },
        "validate-only": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    console.error("Invalid command arguments.");
    return 1;
  }

  const exportPaths = values["export-path"] ?? [];
  if (exportPaths.length === 0) {
    console.error("At least one --export-path value is required.");
    return 1;
  }

  if (values["validate-only"]) {
    const report = await validateCollection(exportPaths);
    console.log(formatTerminalSummary(report));

    const reportPath = values["report-path"];
    if (reportPath) {
      try {
        writeValidationReport(reportPath, report);
        console.log("Validation report written successfully.");
      } catch {
        console.error("Validation report could not be written.");
        return 1;
      }
    }
    return report.status === "completed"
      ? 0
      : report.status === "completed_with_errors"
        ? 2
        : 1;
  }

  const databasePath = values["database-path"];
  if (!databasePath) {
    console.error("--database-path is required for an import.");
    return 1;
  }

  try {
    const migrationsDirectory = fileURLToPath(
      new URL("../migrations", import.meta.url),
    );
    const report = await importTimelineCollection({
      exportPaths,
      databasePath,
      migrationsDirectory,
    });
    console.log(formatImportTerminalSummary(report));
    const reportPath =
      values["report-path"] ?? join(dirname(databasePath), "last-import-report.json");
    try {
      writeJsonReport(reportPath, report);
      console.log("Import report written successfully.");
    } catch {
      console.error("Import completed, but the report could not be written.");
      return 1;
    }
    return report.status === "completed"
      ? 0
      : report.status === "completed_with_errors"
        ? 2
        : 1;
  } catch (error) {
    console.error(
      error instanceof Error ? `Import failed: ${error.message}` : "Import failed.",
    );
    return 1;
  }
}

process.exitCode = await main();
