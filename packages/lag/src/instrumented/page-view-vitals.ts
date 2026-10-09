import type { AbsoluteClockDeps, CoreDeps, EventDeps, FrameDeps, LifecycleDeps, ObserverDeps, PageDeps, PerformanceDeps, SpanDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { isVisibleState, type LifecycleStateMachine } from "../LifecycleStateMachine.js";
import type { Histogram } from "../meter.js";
import { PageViewVitals } from "../vitals/PageViewVitals.js";
import { rateVital, type NavigationType, type VitalName, type VitalValue } from "../vitals/types.js";
import type { PageView } from "../vitals/ViewCollector.js";
import { EVENTS, METRICS, createHistogram, type MetricDefinition } from "../metric-catalog.js";
import type { EventAttributes, EventSink } from "../events.js";
import type { AbsoluteClock } from "../absolute-clock.js";
import { createHandle, eventClock, occurredAt, PAGE_VIEW_SPAN_ID, PAGE_VIEW_TRACE_ID } from "./shared.js";
import type { SpanIdentity } from "../spans.js";

const DEFINITIONS : Readonly<Record<VitalName, MetricDefinition>> = {
    INP : METRICS.vitalInp,
    CLS : METRICS.vitalCls,
    LCP : METRICS.vitalLcp,
    FCP : METRICS.vitalFcp,
    TTFB : METRICS.vitalTtfb,
};

type VitalAttributes = { navigation_type : NavigationType };

/**
 * This factory makes `PageViewVitals` with one histogram for each vital,
 * with the attribute `navigation_type`, and with `browser.web_vital` events.
 *
 * The histogram of a vital gets one value for each page view: the value at
 * the first report. Usually, the first report occurs when the page becomes
 * hidden for the first time. A histogram cannot remove a value, thus later
 * changes go only into events.
 * For example, the INP of a page view can increase when the user comes back
 * to the tab. Each event has a `delta`. The latest event for each
 * `browser.web_vital.id` has the final value.
 *
 * The time of an event is the time of the occurrence that gave the value
 * (`VitalValue.time`), not the time of the report. Each page view also
 * emits a `lag.page_view.start` event at its start.
 *
 * With `deps.pageViewSpans`, the factory starts the span of each view at its
 * start. The span ends when the page is hidden for the first time in the
 * view, or at the final report of the view (refer to `PageViewSpans`).
 */
export function createInstrumentedPageViewVitals(
    deps : CoreDeps & ObserverDeps & Partial<PerformanceDeps> & Partial<AbsoluteClockDeps> & Partial<EventDeps> & Partial<Pick<SpanDeps, "pageViewSpans">> & Partial<Pick<FrameDeps, "requestAnimationFrame">> & Partial<PageDeps> & Partial<Pick<LifecycleDeps, "window">>,
    lifecycle : LifecycleStateMachine,
) : MonitorHandle<PageViewVitals> {
    return createHandle("page-view-vitals", deps.logger, () => {
        const histograms = {} as Record<VitalName, Histogram<VitalAttributes>>;
        for (const name of Object.keys(DEFINITIONS) as VitalName[]) {
            histograms[name] = createHistogram<VitalAttributes>(deps.meter, DEFINITIONS[name]);
        }
        /** The last reported value of each vital of each open view, keyed "viewId:name". */
        const reported = new Map<string, number>();
        const performance = deps.performance;
        const clock = eventClock(deps);

        const monitor = new PageViewVitals(({ view, values, final }) => {
            for (const vital of values) {
                const key = `${view.id}:${vital.name}`;
                const last = reported.get(key);
                if (last === undefined) {
                    histograms[vital.name].record(vital.value, { navigation_type : view.navigationType });
                }
                if (last !== vital.value && deps.events) emitVital(deps.events, view, vital, last, clock);
                reported.set(key, vital.value);
            }
            if (final) {
                for (const key of [...reported.keys()]) {
                    if (key.startsWith(`${view.id}:`)) reported.delete(key);
                }
                deps.pageViewSpans?.viewEnded(view, values);
            }
        }, {
            logger : deps.logger,
            clock : deps.clock,
            PerformanceObserver : deps.PerformanceObserver,
            lifecycle,
            ...(performance ? { readInteractionCount : () => performance.interactionCount } : {}),
            ...(deps.page ? { page : deps.page } : {}),
            ...(deps.requestAnimationFrame ? { requestAnimationFrame : deps.requestAnimationFrame } : {}),
            ...(deps.describeNode ? { describeNode : deps.describeNode } : {}),
            ...(deps.softNavigations !== undefined ? { softNavigations : deps.softNavigations } : {}),
            // The key presses and clicks make the LCP final
            ...(deps.window ? { inputTarget : deps.window } : {}),
        });

        const { events, pageViewSpans } = deps;
        const unsubscribers : Array<() => void> = [];
        if (pageViewSpans) {
            // After the subscription of the monitor: the values are the values of the checkpoint of the transition
            unsubscribers.push(lifecycle.subscribe(({ to, timestamp }) => {
                if (!isVisibleState(to)) pageViewSpans.viewHidden(monitor.getView(), monitor.getValues(), timestamp);
            }));
        }
        if (events || pageViewSpans) {
            let previous = monitor.getView();
            pageViewSpans?.viewStarted(previous);
            if (events) emitViewStart(events, previous, undefined, clock, pageViewSpans?.current());
            unsubscribers.push(monitor.subscribe((view) => {
                pageViewSpans?.viewStarted(view);
                if (events) emitViewStart(events, view, previous, clock, pageViewSpans?.current());
                previous = view;
            }));
        }

        return {
            monitor,
            stop : () => {
                for (const unsubscribe of unsubscribers) unsubscribe();
                monitor.stop();
            },
        };
    });
}

/**
 * This function sends one `browser.web_vital` event with the attribute names
 * of the OpenTelemetry semantic conventions (v1.44). The attribution and the
 * page view attributes have the `lag.` prefix, because the conventions do
 * not define them.
 */
function emitVital(events : EventSink, view : PageView, vital : VitalValue, last : number | undefined, clock : AbsoluteClock | undefined) : void {
    const name = vital.name.toLowerCase();
    const attributes : Record<string, EventAttributes[string]> = {
        "browser.web_vital.name" : name,
        "browser.web_vital.value" : vital.value,
        "browser.web_vital.delta" : vital.value - (last ?? 0),
        "browser.web_vital.id" : `${view.id}-${name}`,
        "browser.web_vital.rating" : rateVital(vital.name, vital.value),
        "browser.web_vital.navigation_type" : view.navigationType,
        "lag.page_view.id" : view.id,
    };
    if (view.url !== undefined) attributes["lag.page_view.url"] = view.url;
    for (const [key, value] of Object.entries(vital.attribution)) {
        attributes[`lag.web_vital.${key}`] = value;
    }
    events.emit(EVENTS.webVital.name, attributes, occurredAt(clock, vital.time));
}

/**
 * This function sends one `lag.page_view.start` event, at the start of the
 * view. With a sampled span of the view, the event has the identity of the
 * span. Thus a dashboard can link the view to its trace.
 */
function emitViewStart(events : EventSink, view : PageView, previous : PageView | undefined, clock : AbsoluteClock | undefined, span : SpanIdentity | undefined) : void {
    events.emit(EVENTS.pageViewStart.name, {
        navigation_type : view.navigationType,
        "lag.page_view.id" : view.id,
        ...(view.url !== undefined ? { "lag.page_view.url" : view.url } : {}),
        ...(previous ? { "lag.page_view.previous_id" : previous.id } : {}),
        ...(span && span.sampled !== false ? { [PAGE_VIEW_TRACE_ID] : span.traceId, [PAGE_VIEW_SPAN_ID] : span.spanId } : {}),
    }, occurredAt(clock, view.startTime));
}
