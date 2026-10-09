import { siteContent } from "../content/site-content";
import type { SessionFactory } from "../playground/SessionFactoryContext";
import { cachedReportSource, HttpReportSource } from "../results/report-source";
import { createBrowserPreferenceStore } from "../theme/preferences";
import { isPrerendering } from "./prerender-handoff";
import { sessionsWithoutStart } from "./prerender-sessions";
import { siteSections } from "./sections";
import type { SiteServices } from "./SiteProviders";

/** The monitor code loads only when a page starts a session. */
export const browserSessionFactory : SessionFactory = (kind) =>
    import("../playground/browser-session").then(module => module.createBrowserSession(kind));

/** The services of the real site. In the prerender of the build, the live sessions do not start. */
export function createDefaultServices(prerender : boolean = isPrerendering()) : SiteServices {
    return {
        sections : siteSections,
        content : siteContent,
        reports : cachedReportSource(new HttpReportSource({ baseUrl : import.meta.env.BASE_URL })),
        preferences : createBrowserPreferenceStore(),
        sessions : prerender ? sessionsWithoutStart(browserSessionFactory) : browserSessionFactory,
    };
}
