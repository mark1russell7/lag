/**
 * The helpers that the instrumented factories share.
 *
 * Each factory makes its instruments from the metric catalog
 * (`metric-catalog.ts`), which also gives the attribute rules.
 */

import type { Clock, Logger } from "../types.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { MeasurementConditions, SampleValidator } from "../measurement-conditions.js";
import type { AbsoluteClockDeps, PerformanceDeps, SpanDeps } from "../dep-groups.js";
import type { EventAttributes, EventOptions } from "../events.js";
import { isSpanIdentity, type SpanIdentity } from "../spans.js";
import { SPANS } from "../metric-catalog.js";
import { createAbsoluteClock, type AbsoluteClock } from "../absolute-clock.js";

/** The context attributes with the identity of the span of the page view (refer to the page-view context). */
export const PAGE_VIEW_TRACE_ID = "lag.page_view.trace_id";
export const PAGE_VIEW_SPAN_ID = "lag.page_view.span_id";

/** The span of the page view in the context attributes of a page, if they have a valid identity. */
export function pageViewSpanOf(attributes : Readonly<Record<string, unknown>>) : SpanIdentity | undefined {
    const identity = { traceId : attributes[PAGE_VIEW_TRACE_ID], spanId : attributes[PAGE_VIEW_SPAN_ID] };
    return isSpanIdentity(identity) ? identity : undefined;
}

/**
 * This function records the span of a hang. The parent is the page view of
 * the page that hung, when the context of that page (`hungPage`) has the
 * identity of its span. Then the span is in the trace of that page. It has
 * a link to the current page view of this page, which reports it. Else
 * the parent is the current page view of this page.
 */
export function recordHangSpan(
    deps : Partial<SpanDeps>,
    hang : { startedAt : number; durationMs : number; attributes : EventAttributes; hungPage? : Readonly<Record<string, unknown>> },
) : void {
    if (!deps.spans) return;
    const current = deps.pageViewSpans?.current();
    const hungView = hang.hungPage ? pageViewSpanOf(hang.hungPage) : undefined;
    const parent = hungView ?? current;
    const link = hungView && current && hungView.spanId !== current.spanId ? current : undefined;
    deps.spans.record(SPANS.hang.name, {
        startTime : hang.startedAt,
        endTime : hang.startedAt + hang.durationMs,
        attributes : hang.attributes,
        ...(parent ? { parent } : {}),
        ...(link ? { links : [link] } : {}),
    });
}

/** This function records a span of a monitor in the current page view. Without a span sink, it does nothing. */
export function recordSpan(deps : Partial<SpanDeps>, name : string, startTime : number, endTime : number, attributes : EventAttributes) : void {
    if (!deps.spans) return;
    const parent = deps.pageViewSpans?.current();
    deps.spans.record(name, { startTime, endTime, attributes, ...(parent ? { parent } : {}) });
}

/**
 * This function gives the clock for the times of the events of a factory:
 * the absolute clock of `setupAllMonitors`, or a new one from `performance`.
 * Without both, the events have no time, and the sink uses the time of the
 * call.
 */
export function eventClock(deps : Partial<AbsoluteClockDeps> & Partial<PerformanceDeps>) : AbsoluteClock | undefined {
    return deps.absoluteClock ?? (deps.performance ? createAbsoluteClock(deps.performance) : undefined);
}

/** The options of an event that occurred at `monotonicTime` (`performance.now()` time, for example the start time of an entry). */
export function occurredAt(clock : AbsoluteClock | undefined, monotonicTime : number | undefined) : EventOptions {
    return clock && monotonicTime !== undefined ? { time : clock.origin + monotonicTime } : {};
}

/**
 * The options of an event that occurred at `clockTime`, a time of the clock
 * of the monitors (`deps.clock`). The function uses the distance from the
 * present time. Thus the time base of that clock does not matter.
 */
export function occurredAtClockTime(absoluteClock : AbsoluteClock | undefined, clock : Clock, clockTime : number) : EventOptions {
    return absoluteClock ? { time : absoluteClock.now() - (clock.now() - clockTime) } : {};
}

/**
 * This function starts `build` behind an error boundary. If the construction
 * throws an error, for example because a browser API is missing, the
 * function logs a warning. Then it gives a handle with `monitor: undefined`
 * and a `stop()` that does nothing.
 */
export function createHandle<T>(
    name : string,
    logger : Logger,
    build : () => { monitor : T; stop : () => void },
) : MonitorHandle<T> {
    try {
        const { monitor, stop } = build();
        return { name, monitor, stop };
    } catch (error) {
        logger.log("warn", `Failed to create the "${name}" monitor.`, { error, monitor : name });
        return { name, monitor : undefined, stop : () => {} };
    }
}

/**
 * This function gives the recorder through which a timer-driven monitor
 * reports. With `conditions`, `submit` sends each sample to a validator.
 * Without `conditions`, `submit` records the sample directly. `windowMs`
 * gives the length of the measurement window that ends at this time, and
 * `record` gets it too. `dispose` cancels the samples that wait for evidence.
 */
export function validatedRecorder(
    conditions : MeasurementConditions | undefined,
    record : (value : number, windowMs : number) => void,
) : { submit : (value : number, windowMs : number) => void; dispose : () => void } {
    const validator : SampleValidator | undefined = conditions?.createValidator();
    return {
        submit : validator
            ? (value, windowMs) => validator.submit(value, windowMs, (valid) => record(valid, windowMs))
            : (value, windowMs) => record(value, windowMs),
        dispose : () => validator?.dispose(),
    };
}
