import { pageTitle } from "../app/site";

/** One view of a test run. The path "." is the overview of the run. */
export type RunPage = {
    path : string;
    label : string;
    /** The end of the page description, after "Test run <ID> of lag: ". */
    summary : string;
};

/**
 * The views of a run, in navigation order. The navigation of a run
 * (`views/RunLayout.tsx`) and the static pages of the build use this list.
 * To add a view, add a route in `app/sections.tsx` and an entry here.
 */
export const RUN_PAGES : readonly RunPage[] = [
    { path : ".", label : "Overview", summary : "the tests of each package in each environment, and the failed tests." },
    { path : "tests", label : "Tests", summary : "the result of each test, for each package and environment." },
    { path : "coverage", label : "Coverage", summary : "the code coverage by package and by file." },
    { path : "mutation", label : "Mutation", summary : "the mutation score by package and by file, from Stryker." },
    { path : "budgets", label : "Budgets", summary : "the performance budgets, and if each budget passes." },
    { path : "measurements", label : "Measurements", summary : "the measurements of the tests, with their percentiles." },
];

/** The view of a run for a URL path: "/results/<ID>/tests" gives the tests view, and "/results/<ID>" gives the overview. */
export function runPageOf(pathname : string) : RunPage {
    const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    return RUN_PAGES.find(page => page.path === last) ?? RUN_PAGES[0]!;
}

/** The document title of a view of a run: "Run <ID> – lag" for the overview, and "Tests of run <ID> – lag" for another view. */
export function runPageTitle(runId : string, page : RunPage) : string {
    return pageTitle(page.path === "." ? `Run ${runId}` : `${page.label} of run ${runId}`);
}
