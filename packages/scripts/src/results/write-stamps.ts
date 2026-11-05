/**
 * This script writes `data-stamps.json` to the root of the built site. It reads the run from the index that
 * `pnpm results` wrote in the same workflow run, so no date or version is typed. Start it after the site build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actionsRunUrl, resultsStamps, type StampIndex } from "./stamp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const readJson = (file : string) : unknown => JSON.parse(readFileSync(path.join(root, file), "utf8"));

const index = readJson("packages/site/public/data/results/index.json") as StampIndex;
const { version } = readJson("packages/lag/package.json") as { version : string };
const stamps = resultsStamps(index, version, actionsRunUrl(process.env));

writeFileSync(path.join(root, "packages/site/dist/data-stamps.json"), `${JSON.stringify(stamps, null, 2)}\n`);
console.log(`Data stamp: run ${stamps.pages[0]?.runs[0]?.id}, ${version}.`);
