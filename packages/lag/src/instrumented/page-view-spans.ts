import type { AbsoluteClock } from "../absolute-clock.js";
import type { OpenSpan, SpanIdentity, SpanSink } from "../spans.js";
import type { PageView } from "../vitals/ViewCollector.js";
import type { VitalValue } from "../vitals/types.js";
import { SPANS } from "../metric-catalog.js";

/**
 * The span of each page view: one trace for each view. The page-view vitals
 * start the span at the start of the view. The span ends at the first of
 * these occurrences:
 *
 * - The page becomes hidden for the first time in the view. The browser can
 *   discard a hidden page without an event, and an exporter sends only the
 *   spans that ended. Thus the span ends when the page is hidden.
 * - The final report of the view.
 * - The start of the next view.
 *
 * The span gets the values of the vitals at its end as attributes. The
 * values that change after the end are in the metrics and in the events.
 * The other monitors use the span of the current view as the parent of
 * their spans (`current()`). This continues after the end of the span,
 * until the view ends.
 */
export type PageViewSpans = {
    viewStarted(view : PageView) : void;
    /**
     * The page is not visible (the lifecycle state is not active or
     * passive) at `time`, in the time of the clock of the monitors. The span of `view` ends at
     * that time with `values`, if it did not end before.
     */
    viewHidden(view : PageView, values : readonly VitalValue[], time : number) : void;
    /** The final report of `view`: the span ends at this time with `values`, if it did not end before. */
    viewEnded(view : PageView, values : readonly VitalValue[]) : void;
    /** The identity of the span of the current view, or undefined when no view is open. */
    current() : SpanIdentity | undefined;
};

/**
 * This function makes the page-view spans. The times come from `clock`, as
 * the times of the events. Without a clock, the spans use `Date.now()`.
 */
export function createPageViewSpans(spans : SpanSink, clock : AbsoluteClock | undefined) : PageViewSpans {
    let open : { viewId : string; span : OpenSpan; ended : boolean } | undefined;
    const timeOf = (monotonicTime : number) : number => clock ? clock.origin + monotonicTime : Date.now();
    const now = () : number => clock ? clock.now() : Date.now();

    const end = (values : readonly VitalValue[], time : number) : void => {
        if (!open || open.ended) return;
        const attributes : Record<string, number> = {};
        for (const vital of values) attributes[`lag.web_vital.${vital.name.toLowerCase()}`] = vital.value;
        open.span.setAttributes(attributes);
        open.span.end(time);
        open.ended = true;
    };

    return {
        viewStarted(view) {
            if (open?.viewId === view.id) return;
            end([], timeOf(view.startTime));
            const span = spans.start(SPANS.pageView.name, {
                startTime : timeOf(view.startTime),
                attributes : {
                    "lag.page_view.id" : view.id,
                    navigation_type : view.navigationType,
                    ...(view.url !== undefined ? { "lag.page_view.url" : view.url } : {}),
                },
            });
            open = { viewId : view.id, span, ended : false };
        },
        viewHidden(view, values, time) {
            if (open?.viewId === view.id) end(values, timeOf(time));
        },
        viewEnded(view, values) {
            if (open?.viewId !== view.id) return;
            end(values, now());
            open = undefined;
        },
        current : () => open?.span.identity,
    };
}
