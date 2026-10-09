/** The name of the project and the site. */
export const SITE_NAME = "lag";

/** One sentence that says what the project is. */
export const SITE_TAGLINE = "Main-thread responsiveness monitoring for browser apps, exported as OpenTelemetry metrics.";

/** The document title of the home page. `index.html` has the same title, and a test compares them. */
export const HOME_TITLE = `${SITE_NAME}: browser main-thread lag monitoring with OpenTelemetry`;

/** The main heading of the home page. The Open Graph image of the home page shows it too. */
export const HOME_HEADING = "Measure how long the main thread makes users wait";

/** The repository of the project. */
export const REPOSITORY_URL = "https://github.com/mark1russell7/lag";

/** The address of the published site. The build uses the `SITE_URL` environment variable first. */
export const PUBLISHED_URL = "https://mark1russell7.github.io/lag/";

/** The SPDX ID of the license of the project, for the structured data of the site. */
export const LICENSE = "MIT";

/** The author of the project, for the structured data of the site. */
export const AUTHOR = { name : "Mark Russell", url : "https://github.com/mark1russell7" } as const;

/** What the library does, for the structured data of the site. */
export const LIBRARY_DESCRIPTION = "A TypeScript library that measures the lag of the main thread in browser apps, on the devices of real users, "
    + "and exports the results as OpenTelemetry metrics and events.";

/** The topics of the library, for the structured data of the site. */
export const KEYWORDS : readonly string[] = [
    "main thread",
    "main-thread lag",
    "event loop lag",
    "long tasks",
    "Long Animation Frames",
    "INP",
    "Web Vitals",
    "real user monitoring",
    "OpenTelemetry",
    "browser metrics",
];

/** The document title of a page: "DriftLag – lag". The build uses the same form (refer to `build/static-routes.ts`). */
export function pageTitle(heading : string) : string {
    return `${heading} – ${SITE_NAME}`;
}
