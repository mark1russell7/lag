/**
 * The browser projects of `@lag/integration-tests` that the results collector
 * operates. The collector operates one Vitest run for each project, one after
 * another, as the browser jobs of the CI workflow (`.github/workflows/ci.yml`)
 * do. The timing tests measure milliseconds, and a runner has few CPUs. When
 * all the engines operate at the same time, each engine uses the CPU that the
 * tests of the other engines measure.
 *
 * For example, the Pages workflow operated all the projects in one Vitest
 * run. Then the I/O of a Firefox worker did not complete during a block of
 * 2 s (experiment E6) in 7 of 41 runs. In the CI workflow, which operates one
 * project at a time, it completed in each run.
 */

/** The projects of each engine, in the order of the matrix of `ci.yml`. A test compares the two lists. */
export const BROWSER_PROJECT_GROUPS : Readonly<Record<"chromium" | "firefox" | "webkit", readonly string[]>> = {
    chromium : ["browser (chromium)", "browser (chrome)", "cdp", "bfcache", "coi (chromium)"],
    firefox : ["browser (firefox)", "coi (firefox)"],
    webkit : ["browser (webkit)", "coi (webkit)"],
};

/** All the browser projects, one engine after the other. */
export const BROWSER_PROJECTS : readonly string[] = Object.values(BROWSER_PROJECT_GROUPS).flat();

/**
 * This function reads the value of the option `--projects`: a JSON array
 * (the format of the matrix of the workflows), or names with commas between
 * them. It removes spaces at the start and the end of each name, and the
 * names that occur two times. It gives an error for a value without names.
 */
export function parseProjectList(value : string) : string[] {
    const text = value.trim();
    let names : unknown[];
    if (text.startsWith("[")) {
        const parsed : unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error(`--projects: ${text} is not a JSON array.`);
        names = parsed;
    } else {
        names = text.split(",");
    }
    const projects = [...new Set(names.map((name) => {
        if (typeof name !== "string") throw new Error(`--projects: ${JSON.stringify(name)} is not a project name.`);
        return name.trim();
    }).filter(name => name.length > 0))];
    if (projects.length === 0) throw new Error("--projects: the value has no project names.");
    return projects;
}
