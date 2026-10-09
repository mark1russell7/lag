import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HOME_HEADING, pageTitle, SITE_NAME } from "../src/app/site";
import { RUN_PAGES } from "../src/results/run-pages";
import { extractFrontmatter } from "./frontmatter";

/**
 * The type of a page, for the structured data. A page of the docs, the
 * research or the thesis is an article. The home page and the pages of the
 * app have their own types.
 */
export type RouteKind = "home" | "article" | "page";

/** One page that the build writes as its own HTML file. */
export type StaticRoute = {
    /** The path after the base URL, without slashes at the ends, for example "docs/monitors/drift-lag". The home page is "". */
    path : string;
    /** The document title, for example "DriftLag – lag". */
    title : string;
    /** The title of the page without the site name, for example "DriftLag". */
    heading : string;
    description? : string;
    kind : RouteKind;
    /** The group of the page, for example "Monitors" or "Research". The Open Graph image shows it above the title. */
    section : string;
    /** The name of the page in the breadcrumbs, if it is not the heading. For example "Docs" for the overview of the docs. */
    crumb? : string;
    /** True for a page that search engines must not keep, for example a test run that the next deploy replaces. */
    noindex? : boolean;
};

export function escapeHtml(text : string) : string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeHtml(text : string) : string {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

/** "docs" gives "Docs", and "getting-started" gives "Getting started", as the navigation and the sidebar show the names. */
export function sectionLabel(segment : string) : string {
    const words = segment.replace(/[-_]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The pages of the app that have no MDX file, with their titles and descriptions. The components show the same titles. */
export const APP_PAGES : ReadonlyArray<{ path : string; heading : string; description : string }> = [
    {
        path : "playground",
        heading : "Playground",
        description : "Start the lag monitors in your browser, make main-thread load with the buttons, and see the timer drift, "
            + "the blocks that the worker measures, the frame delta and the event durations live.",
    },
    {
        path : "results",
        heading : "Test results",
        description : "The newest results of the lag test program: the tests in each browser, code coverage, mutation scores, "
            + "performance budgets and lag measurements.",
    },
];

async function mdxFiles(dir : string, prefix = "") : Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes : true });
    const files : string[] = [];
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...await mdxFiles(path.join(dir, entry.name), relative));
        else if (entry.name.endsWith(".mdx")) files.push(relative);
    }
    return files;
}

/**
 * This function gives the routes of the content pages, as the content
 * registry gives them: "docs/index.mdx" is "docs", and
 * "docs/monitors/drift-lag.mdx" is "docs/monitors/drift-lag". The title is
 * the title in the frontmatter, as the page shows it.
 */
export async function contentRoutes(contentDir : string) : Promise<StaticRoute[]> {
    const routes : StaticRoute[] = [];
    for (const file of await mdxFiles(contentDir)) {
        const meta = extractFrontmatter(await readFile(path.join(contentDir, file), "utf8"));
        const route = file.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");
        const segments = file.split("/");
        const top = segments[0] ?? "";
        // The first folder in the section, as the sidebar groups the pages: "docs/monitors/drift-lag.mdx" is in "monitors".
        const folder = segments.length > 2 ? segments[1] : undefined;
        const heading = typeof meta["title"] === "string" ? meta["title"].trim() : route;
        routes.push({
            path : route,
            title : pageTitle(heading),
            heading,
            ...(typeof meta["description"] === "string" ? { description : meta["description"] } : {}),
            kind : "article",
            section : sectionLabel(folder ?? top),
            ...(route === top ? { crumb : sectionLabel(top) } : {}),
        });
    }
    return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * This function gives the routes of the results section for the runs in
 * `index.json` of the results data. Each deploy has new runs, thus the
 * pages of a run are not for search engines.
 */
export function resultsRoutes(index : unknown) : StaticRoute[] {
    const runs = (index as { runs? : Array<{ id? : unknown }> } | null)?.runs ?? [];
    const routes : StaticRoute[] = [];
    for (const run of runs) {
        if (typeof run.id !== "string" || !/^[\w.-]+$/.test(run.id)) continue;
        for (const page of RUN_PAGES) {
            const heading = page.path === "." ? `Run ${run.id}` : `${page.label} of run ${run.id}`;
            routes.push({
                path : page.path === "." ? `results/${run.id}` : `results/${run.id}/${page.path}`,
                title : pageTitle(heading),
                heading,
                description : `Test run ${run.id} of ${SITE_NAME}: ${page.summary}`,
                kind : "page",
                section : "Results",
                noindex : true,
            });
        }
    }
    return routes;
}

/** The routes of the app pages without an MDX file: the playground and the list of test runs. */
export function appRoutes() : StaticRoute[] {
    return APP_PAGES.map(page => ({
        path : page.path,
        title : pageTitle(page.heading),
        heading : page.heading,
        description : page.description,
        kind : "page",
        section : sectionLabel(page.path),
        crumb : sectionLabel(page.path),
    }));
}

/**
 * The route of the home page. The title and the description come from
 * `index.html`, because the home page uses them too.
 */
export function homeRoute(template : string) : StaticRoute {
    const title = unescapeHtml(/<title>([\s\S]*?)<\/title>/.exec(template)?.[1]?.trim() ?? SITE_NAME);
    const description = /<meta name="description" content="([^"]*)"/.exec(template)?.[1];
    return {
        path : "",
        title,
        heading : HOME_HEADING,
        ...(description === undefined ? {} : { description : unescapeHtml(description) }),
        kind : "home",
        section : SITE_NAME,
        crumb : SITE_NAME,
    };
}

/**
 * Every page of the site: the home page, the content pages in path order,
 * the app pages, and the pages of each test run. A new MDX file adds a route.
 */
export async function siteRoutes(template : string, contentDir : string, resultsIndex : unknown) : Promise<StaticRoute[]> {
    return [homeRoute(template), ...await contentRoutes(contentDir), ...appRoutes(), ...resultsRoutes(resultsIndex)];
}

/**
 * This function gives the HTML of one route: the HTML of the app with the
 * title and the description of the route. The app sets the title again when
 * it starts. A search engine and a link preview read them before that.
 */
export function routeHtml(template : string, route : StaticRoute) : string {
    let html = template.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(route.title)}</title>`);
    if (route.description !== undefined) {
        const description = route.description;
        html = html.replace(
            /<meta name="description" content="[^"]*"\s*\/?>/,
            () => `<meta name="description" content="${escapeHtml(description)}" />`,
        );
    }
    return html;
}

/** The title of the page that GitHub Pages serves for an unknown path. The app shows the same title (refer to `NotFoundPage`). */
export const NOT_FOUND_TITLE = pageTitle("Page not found");

/**
 * The HTML of `404.html`: the app with an empty root element and the title
 * of the not-found page. A `noindex` rule tells search engines not to keep
 * the address. For an unknown path, GitHub Pages serves this file, and the
 * router of the app shows the page.
 */
export function notFoundHtml(template : string) : string {
    return template
        .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(NOT_FOUND_TITLE)}</title>\n        <meta name="robots" content="noindex" />`)
        .replace(/\s*<meta name="description" content="[^"]*"\s*\/?>/, "");
}

/**
 * The files of one route. GitHub Pages serves "drift-lag.html" for the path
 * "drift-lag". A route that is also a folder, for example "docs/monitors",
 * also gets "docs/monitors/index.html", for the path with a slash at the end.
 * The home page is "index.html".
 */
export function routeFiles(route : Pick<StaticRoute, "path">) : string[] {
    return route.path === "" ? ["index.html"] : [`${route.path}.html`, `${route.path}/index.html`];
}
