/**
 * This script writes the metric table of the root README from the metric
 * catalog of `@lag/core`. The table is between the markers
 * `<!-- metrics:start -->` and `<!-- metrics:end -->`.
 *
 * Usage: `pnpm readme:metrics` writes the table. `pnpm readme:metrics --check`
 * fails if the README does not agree with the catalog.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { METRIC_CATALOG, type MetricDefinition } from "@lag/core";

export const START_MARKER = "<!-- metrics:start -->";
export const END_MARKER = "<!-- metrics:end -->";

/**
 * This function makes a table cell. It escapes the pipe character and
 * removes the line breaks, because they break the Markdown table.
 */
function cell(text : string) : string {
    return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function attributesOf(definition : MetricDefinition) : string {
    const names = Object.keys(definition.attributes);
    return names.length === 0 ? "" : names.map(name => `\`${name}\``).join(", ");
}

/** The Markdown table of all metrics, grouped by monitor in the sequence of the catalog. */
export function renderMetricTable(catalog : readonly MetricDefinition[]) : string {
    const lines = [
        "| Monitor | Metric | Type | Unit | Attributes | Description |",
        "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const definition of catalog) {
        lines.push(`| ${definition.monitor} | \`${definition.name}\` | ${definition.kind} | \`${definition.unit}\` | ${attributesOf(definition)} | ${cell(definition.description)} |`);
    }
    return lines.join("\n");
}

/** The text with `content` between the two markers. The function fails if a marker is missing. */
export function replaceBetweenMarkers(text : string, content : string) : string {
    const start = text.indexOf(START_MARKER);
    const end = text.indexOf(END_MARKER);
    if (start < 0 || end < start) throw new Error(`The README must contain ${START_MARKER} and then ${END_MARKER}.`);
    return `${text.slice(0, start + START_MARKER.length)}\n${content}\n${text.slice(end)}`;
}

function main() : void {
    const readmePath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../README.md");
    const current = readFileSync(readmePath, "utf8");
    const next = replaceBetweenMarkers(current, renderMetricTable(METRIC_CATALOG));
    if (process.argv.includes("--check")) {
        if (next !== current) {
            console.error("The metric table of README.md does not agree with the metric catalog. Use `pnpm readme:metrics`.");
            process.exitCode = 1;
        }
        return;
    }
    writeFileSync(readmePath, next);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
