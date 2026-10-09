import type { CoreDeps, CrashReportContextLike, CrashReportDeps, PageDeps, SpanDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { PageViewVitals } from "../vitals/PageViewVitals.js";
import type { PageView } from "../vitals/ViewCollector.js";
import { createHandle, PAGE_VIEW_SPAN_ID, PAGE_VIEW_TRACE_ID } from "./shared.js";

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
 *
 * With page-view spans, the context also has the identity of the span of
 * the view (`lag.page_view.trace_id` and `lag.page_view.span_id`). Thus the
 * page that reports an abandoned hang can put its span into the trace of
 * the page that hung.
 */
export function createInstrumentedPageViewContext(
    deps : Pick<CoreDeps, "logger"> & Partial<CrashReportDeps> & Partial<Pick<PageDeps, "pageContext">> & Partial<Pick<SpanDeps, "pageViewSpans">>,
    vitals : PageViewVitals,
    receivers : readonly PageContextReceiver[],
) : MonitorHandle<PageViewContext> {
    return createHandle("page-view-context", deps.logger, () => {
        const crashReport = deps.crashReport;
        const crashContextReady = crashReport ? initializeCrashContext(crashReport) : Promise.resolve();
        let attributes : Record<string, string> = {};

        /** The attributes of the app. A failure of the function of the app gives no attributes. */
        const appContext = () : Readonly<Record<string, string>> => {
            try {
                return deps.pageContext?.() ?? {};
            } catch (error) {
                deps.logger.log("warn", "The pageContext function failed.", { error, type : "PageViewContext" });
                return {};
            }
        };

        const apply = (view : PageView) : void => {
            // Only a sampled span: the span of a hang that another page reports is sampled as its parent
            const span = deps.pageViewSpans?.current();
            const sampled = span && span.sampled !== false ? span : undefined;
            attributes = {
                ...appContext(),
                [PAGE_VIEW_KEY] : view.id,
                ...(sampled ? { [PAGE_VIEW_TRACE_ID] : sampled.traceId, [PAGE_VIEW_SPAN_ID] : sampled.spanId } : {}),
            };
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
