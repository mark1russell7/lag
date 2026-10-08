import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractFrontmatter } from "./frontmatter";

/** One page that the build writes as its own HTML file. */
export type StaticRoute = {
    /** The path after the base URL, without slashes at the ends, for example "docs/monitors/drift-lag". */
    path : string;
    title : string;
    description? : string;
};

/** The subviews of one test run, as in the routes of the results section. */
const RUN_VIEWS = ["tests", "coverage", "mutation", "budgets", "measurements"] as const;

const SITE_NAME = "lag";

function escapeHtml(text : string) : string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
        const title = typeof meta["title"] === "string" ? meta["title"] : route;
        routes.push({
            path : route,
            title : `${title} – ${SITE_NAME}`,
            ...(typeof meta["description"] === "string" ? { description : meta["description"] } : {}),
        });
    }
    return routes;
}

/** This function gives the routes of the results section for the runs in `index.json` of the results data. */
export function resultsRoutes(index : unknown) : StaticRoute[] {
    const routes : StaticRoute[] = [{ path : "results", title : `Test results – ${SITE_NAME}` }];
    const runs = (index as { runs? : Array<{ id? : unknown }> } | null)?.runs ?? [];
    for (const run of runs) {
        if (typeof run.id !== "string" || !/^[\w.-]+$/.test(run.id)) continue;
        const title = `Run ${run.id} – ${SITE_NAME}`;
        routes.push({ path : `results/${run.id}`, title });
        for (const view of RUN_VIEWS) routes.push({ path : `results/${run.id}/${view}`, title });
    }
    return routes;
}

/**
 * This function gives the HTML of one route: the HTML of the app with the
 * title and the description of the route. The app replaces both when it
 * starts. A search engine and a link preview read them before that.
 */
export function routeHtml(template : string, route : StaticRoute) : string {
    let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`);
    if (route.description !== undefined) {
        html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(route.description)}" />`);
    }
    return html;
}

/**
 * The files of one route. GitHub Pages serves "drift-lag.html" for the path
 * "drift-lag". A route that is also a folder, for example "docs/monitors",
 * also gets "docs/monitors/index.html", for the path with a slash at the end.
 */
export function routeFiles(route : StaticRoute) : string[] {
    return route.path === "" ? [] : [`${route.path}.html`, `${route.path}/index.html`];
}
