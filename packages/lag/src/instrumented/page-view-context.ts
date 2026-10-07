import type { CoreDeps, CrashReportContextLike, CrashReportDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { PageViewVitals } from "../vitals/PageViewVitals.js";
import type { PageView } from "../vitals/ViewCollector.js";
import { createHandle } from "./shared.js";

/** The crash-report context of the page has this number of bytes for the keys and the values of the monitors. */
const CRASH_CONTEXT_BYTES = 512;

const PAGE_VIEW_KEY = "lag.page_view.id";

/** A receiver of the page context, for example the worker monitor. */
export type PageContextReceiver = {
    setContext(attributes : Record<string, string>) : void;
};

/** The page-view context: the targets that get the ID of the current page view. */
export type PageViewContext = {
    /** The context at this time. */
    getAttributes() : Record<string, string>;
};

/**
 * This factory gives the ID of the current page view to the worker (for its
 * hang reports) and to the crash-report context of the browser (Chrome 145
 * and later). Both of them report while the main thread cannot operate.
 * Thus, they must have the ID before a hang starts.
 */
export function createInstrumentedPageViewContext(
    deps : Pick<CoreDeps, "logger"> & Partial<CrashReportDeps>,
    vitals : PageViewVitals,
    receivers : readonly PageContextReceiver[],
) : MonitorHandle<PageViewContext> {
    return createHandle("page-view-context", deps.logger, () => {
        const crashReport = deps.crashReport;
        const crashContextReady = crashReport ? initializeCrashContext(crashReport) : Promise.resolve();
        let attributes : Record<string, string> = {};

        const apply = (view : PageView) : void => {
            attributes = { [PAGE_VIEW_KEY] : view.id };
            for (const receiver of receivers) receiver.setContext(attributes);
            if (crashReport) {
                crashContextReady
                    .then(() => crashReport.set(PAGE_VIEW_KEY, view.id))
                    .catch((error : unknown) => deps.logger.log("debug", "Could not set the crash-report context.", { error }));
            }
        };

        apply(vitals.getView());
        const unsubscribe = vitals.subscribe(apply);

        return {
            monitor : { getAttributes : () => ({ ...attributes }) },
            stop : () => {
                unsubscribe();
                if (crashReport?.delete) {
                    crashContextReady.then(() => crashReport.delete?.(PAGE_VIEW_KEY)).catch(() => {});
                }
            },
        };
    });
}

/**
 * `initialize(length)` is necessary before the first `set` of the
 * crash-report context. A second `initialize` fails, for example when
 * another script of the page initialized the context already. In that case,
 * `set` operates correctly.
 */
function initializeCrashContext(crashReport : CrashReportContextLike) : Promise<unknown> {
    try {
        return Promise.resolve(crashReport.initialize?.(CRASH_CONTEXT_BYTES)).catch(() => undefined);
    } catch {
        return Promise.resolve();
    }
}
