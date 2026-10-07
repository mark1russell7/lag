import type { CoreDeps, EventDeps, FrameDeps, ObserverDeps, PageDeps, PerformanceDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import type { Histogram } from "../meter.js";
import { PageViewVitals } from "../vitals/PageViewVitals.js";
import { rateVital, type NavigationType, type VitalName, type VitalValue } from "../vitals/types.js";
import type { PageView } from "../vitals/ViewCollector.js";
import { EVENTS, METRICS, createHistogram, type MetricDefinition } from "../metric-catalog.js";
import type { EventAttributes, EventSink } from "../events.js";
import { createHandle } from "./shared.js";

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
 */
export function createInstrumentedPageViewVitals(
    deps : CoreDeps & ObserverDeps & Partial<PerformanceDeps> & Partial<EventDeps> & Partial<Pick<FrameDeps, "requestAnimationFrame">> & Partial<PageDeps>,
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

        const monitor = new PageViewVitals(({ view, values, final }) => {
            for (const vital of values) {
                const key = `${view.id}:${vital.name}`;
                const last = reported.get(key);
                if (last === undefined) {
                    histograms[vital.name].record(vital.value, { navigation_type : view.navigationType });
                }
                if (last !== vital.value && deps.events) emitVital(deps.events, view, vital, last);
                reported.set(key, vital.value);
            }
            if (final) {
                for (const key of [...reported.keys()]) {
                    if (key.startsWith(`${view.id}:`)) reported.delete(key);
                }
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
        });

        return { monitor, stop : () => monitor.stop() };
    });
}

/**
 * This function sends one `browser.web_vital` event with the attribute names
 * of the OpenTelemetry semantic conventions (v1.44). The attribution and the
 * page view attributes have the `lag.` prefix, because the conventions do
 * not define them.
 */
function emitVital(events : EventSink, view : PageView, vital : VitalValue, last : number | undefined) : void {
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
    events.emit(EVENTS.webVital.name, attributes);
}
