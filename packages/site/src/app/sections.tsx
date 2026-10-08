import type { RouteObject } from "react-router";
import { ContentRoute } from "../content/components/ContentRoute";
import { ContentCardDetail } from "../home/ContentCardDetail";
import { HomePage } from "../home/HomePage";
import { LatestRunCardDetail } from "../home/LatestRunCardDetail";
import type { SiteSection } from "./section-types";

/** A section of MDX pages in `content/<id>/`. */
function contentSection(id : string, label : string, summary : string) : SiteSection {
    return {
        id,
        label,
        path : `/${id}`,
        routes : [{ path : `${id}/*`, element : <ContentRoute section={id} label={label} /> }],
        card : { summary, Detail : () => <ContentCardDetail section={id} /> },
    };
}

// The results views load on demand, in one chunk. The router waits for the
// chunk before it changes the page, so the old page stays until the new one is ready.
const resultsViews = () => import("../results/views");

function resultsRoute(path : string | undefined, name : keyof Awaited<ReturnType<typeof resultsViews>>, children? : RouteObject[]) : RouteObject {
    const lazy = async () => ({ Component : (await resultsViews())[name] });
    if (path === undefined) return { index : true, lazy };
    return children ? { path, lazy, children } : { path, lazy };
}

const resultsSection : SiteSection = {
    id : "results",
    label : "Results",
    path : "/results",
    routes : [
        resultsRoute("results", "ResultsSection", [
            resultsRoute(undefined, "RunListPage"),
            resultsRoute(":runId", "RunLayout", [
                resultsRoute(undefined, "RunOverview"),
                resultsRoute("tests", "TestsView"),
                resultsRoute("coverage", "CoverageView"),
                resultsRoute("mutation", "MutationView"),
                resultsRoute("budgets", "BudgetsView"),
                resultsRoute("measurements", "MeasurementsView"),
            ]),
        ]),
    ],
    card : {
        summary : "The results of the test program: tests in each browser, coverage, mutation scores, measurements and budgets.",
        Detail : LatestRunCardDetail,
    },
};

const playgroundSection : SiteSection = {
    id : "playground",
    label : "Playground",
    path : "/playground",
    routes : [{
        path : "playground",
        lazy : async () => ({ Component : (await import("../playground/PlaygroundPage")).PlaygroundPage }),
    }],
};

/**
 * The sections of the site, in navigation order. To add a section, add an
 * entry here: the navigation, the routes and the home page read this list.
 */
export const siteSections : readonly SiteSection[] = [
    { id : "home", label : "Home", path : "/", routes : [{ index : true, element : <HomePage /> }] },
    contentSection("docs", "Docs", "How to install and use the monitors, what each monitor measures, and how the parts fit together."),
    contentSection("thesis", "Thesis", "The argument of the project: the problem, the claims, the method and the evidence."),
    contentSection("research", "Research", "Notes on browser support, clocks and timers, OpenTelemetry in the browser and related tools."),
    resultsSection,
    playgroundSection,
];
