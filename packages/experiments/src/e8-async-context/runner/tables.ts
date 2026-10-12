/**
 * This script prints the Markdown tables of a results file of E8. The
 * default file is the data of the page "Local experiments". Give another
 * file as the first argument.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./environment.js";
import { renderTables } from "./report.js";
import type { E8Results } from "./summary.js";

const file = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, "packages/site/content/research/local-experiments.e8.json"));
console.log(renderTables(JSON.parse(readFileSync(file, "utf8")) as E8Results));
