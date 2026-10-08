import { siteContent } from "../content/site-content";
import type { SessionFactory } from "../playground/SessionFactoryContext";
import { cachedReportSource, HttpReportSource } from "../results/report-source";
import { createBrowserPreferenceStore } from "../theme/preferences";
import { siteSections } from "./sections";
import type { SiteServices } from "./SiteProviders";

/** The monitor code loads only when a page starts a session. */
export const browserSessionFactory : SessionFactory = (kind) =>
    import("../playground/browser-session").then(module => module.createBrowserSession(kind));

/** The services of the real site. */
export function createDefaultServices() : SiteServices {
    return {
        sections : siteSections,
        content : siteContent,
        reports : cachedReportSource(new HttpReportSource({ baseUrl : import.meta.env.BASE_URL })),
        preferences : createBrowserPreferenceStore(),
        sessions : browserSessionFactory,
    };
}
