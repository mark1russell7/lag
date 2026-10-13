import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BROWSER_PROJECT_GROUPS, BROWSER_PROJECTS, parseProjectList } from "./browser-projects.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The `projects` of each engine in the matrix of a workflow: `engine: <name>`, then `projects: '<JSON array>'`. */
function matrixProjects(workflow : string) : Record<string, string[]> {
    const text = readFileSync(path.join(root, ".github/workflows", workflow), "utf8");
    const groups : Record<string, string[]> = {};
    for (const match of text.matchAll(/- engine: (\w+)\s*\n(?:\s+\w+: .*\n)*?\s+projects: '(\[.*\])'/g)) {
        groups[match[1]!] = JSON.parse(match[2]!) as string[];
    }
    return groups;
}

describe("the browser projects of the results collector", () => {
    it("are the projects of the browser jobs of ci.yml and pages.yml, for each engine", () => {
        const expected = Object.fromEntries(Object.entries(BROWSER_PROJECT_GROUPS).map(([engine, projects]) => [engine, [...projects]]));

        expect(matrixProjects("ci.yml")).toEqual(expected);
        expect(matrixProjects("pages.yml")).toEqual(expected);
    });

    it("are all the projects of every engine, one engine after the other", () => {
        expect(BROWSER_PROJECTS).toEqual([
            "browser (chromium)", "browser (chrome)", "cdp", "bfcache", "coi (chromium)",
            "browser (firefox)", "coi (firefox)",
            "browser (webkit)", "coi (webkit)",
        ]);
    });
});

describe("parseProjectList", () => {
    it("reads the JSON array of the matrix of a workflow", () => {
        expect(parseProjectList('["browser (firefox)", "coi (firefox)"]')).toEqual(["browser (firefox)", "coi (firefox)"]);
    });

    it("reads names with commas between them, without the spaces at their ends, and each name one time", () => {
        expect(parseProjectList(" browser (webkit) , coi (webkit),,browser (webkit)")).toEqual(["browser (webkit)", "coi (webkit)"]);
    });

    it("gives an error for a value without names, for JSON that is not an array and for a name that is not a string", () => {
        expect(() => parseProjectList(" , ")).toThrow("no project names");
        expect(() => parseProjectList("[]")).toThrow("no project names");
        expect(() => parseProjectList('["cdp", 3]')).toThrow("3 is not a project name");
        expect(() => parseProjectList("[")).toThrow();
    });
});
