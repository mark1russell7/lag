import { SCHEMA_VERSION, type RunIndex, type RunReport } from "../adapters/lag-report";

/** A problem with the result files: a missing file, a bad format or an old schema. */
export class ReportDataError extends Error {
    override readonly name = "ReportDataError";
}

function isRecord(value : unknown) : value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkSchemaVersion(value : unknown, what : string) : void {
    if (value !== SCHEMA_VERSION) {
        throw new ReportDataError(
            `${what} has schema version ${JSON.stringify(value)}. This site reads schema version ${SCHEMA_VERSION}. Run \`pnpm results\` again.`,
        );
    }
}

/** This function checks the shape of `index.json`. */
export function parseRunIndex(value : unknown) : RunIndex {
    if (!isRecord(value)) throw new ReportDataError("The run index is not a JSON object.");
    checkSchemaVersion(value["schemaVersion"], "The run index");
    const runs = value["runs"];
    if (!Array.isArray(runs)) throw new ReportDataError("The run index has no `runs` list.");
    runs.forEach((run : unknown, index) => {
        if (!isRecord(run)
            || typeof run["id"] !== "string"
            || typeof run["file"] !== "string"
            || typeof run["createdAt"] !== "string"
            || !isRecord(run["counts"])
            || !isBudgetCounts(run["budgets"])) {
            throw new ReportDataError(`Run ${index + 1} in the run index is not valid.`);
        }
    });
    return value as RunIndex;
}

/** The budget counts of a run summary. A summary from before the field has none, and that is valid. */
function isBudgetCounts(value : unknown) : boolean {
    if (value === undefined) return true;
    return isRecord(value) && typeof value["pass"] === "number" && typeof value["fail"] === "number";
}

const REPORT_LISTS = ["suites", "coverage", "mutation", "measurements", "budgets"] as const;

/** This function checks the shape of a run file. */
export function parseRunReport(value : unknown) : RunReport {
    if (!isRecord(value)) throw new ReportDataError("The run file is not a JSON object.");
    checkSchemaVersion(value["schemaVersion"], "The run file");
    if (typeof value["id"] !== "string" || typeof value["createdAt"] !== "string") {
        throw new ReportDataError("The run file has no `id` or no `createdAt`.");
    }
    for (const key of REPORT_LISTS) {
        if (!Array.isArray(value[key])) throw new ReportDataError(`The run file has no \`${key}\` list.`);
    }
    return value as RunReport;
}
