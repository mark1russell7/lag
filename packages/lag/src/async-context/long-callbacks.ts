import type { AbsoluteClockDeps, CoreDeps, EventDeps, PerformanceDeps, SpanDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { AllMonitorHandles } from "../setup-all-monitors.js";
import { EVENTS, METRICS, SPANS, createHistogram } from "../metric-catalog.js";
import { RateLimiter } from "../rate-limiter.js";
import { createHandle, eventClock, occurredAtClockTime, recordSpan } from "../instrumented/shared.js";
import { LongCallbackMonitor, type AddCallbackHookFn, type LongCallbackOptions } from "./LongCallbackMonitor.js";
import type { CallbackSourceKind } from "./source-kind.js";

/** The events and spans of long callbacks: no more than this number in each minute. */
const MAX_EVENTS_PER_MINUTE = 10;

/** The callback hook, for the long callback monitor. */
export type CallbackHookDeps = {
    /** `addCallbackHook` of async-browser-context 0.2 or later. */
    addCallbackHook : AddCallbackHookFn;
};

/**
 * This factory makes a `LongCallbackMonitor` that records the duration of
 * each long callback into `lag_long_callback_duration_histogram`, with the
 * attribute `source_kind`.
 *
 * With `deps.events`, each long callback also emits a `lag.long_callback`
 * event. The event has the name of the callback, its source, its source
 * kind, its duration and its operation. With `deps.spans`, it records a
 * `lag.long_callback` span in the current page view. The time of the event
 * and the start of the span are the start of the callback. The factory sends
 * no more than 10 events and spans each minute.
 *
 * `stop()` removes the hook.
 */
export function createInstrumentedLongCallbacks(
    deps : CoreDeps & CallbackHookDeps & Partial<EventDeps> & Partial<SpanDeps> & Partial<AbsoluteClockDeps> & Partial<PerformanceDeps>,
    options : LongCallbackOptions = {},
) : MonitorHandle<LongCallbackMonitor> {
    return createHandle("long-callbacks", deps.logger, () => {
        const durations = createHistogram<{ source_kind : CallbackSourceKind }>(deps.meter, METRICS.longCallbackDuration);
        const limiter = new RateLimiter(deps.clock, MAX_EVENTS_PER_MINUTE, 60_000);
        const absoluteClock = eventClock(deps);

        const monitor = new LongCallbackMonitor(
            deps.addCallbackHook,
            (callback) => {
                durations.record(callback.durationMs, { source_kind : callback.sourceKind });
                // Without an event sink and a span sink, the limit and the attributes have no effect
                if (limiter.tryAcquire()) {
                    const attributes = {
                        duration_ms : callback.durationMs,
                        "callback.name" : callback.name,
                        "callback.source" : callback.source,
                        source_kind : callback.sourceKind,
                        ...(callback.operation !== undefined ? { operation : callback.operation } : {}),
                    };
                    const occurrence = occurredAtClockTime(absoluteClock, deps.clock, callback.startTime);
                    deps.events?.emit(EVENTS.longCallback.name, attributes, occurrence);
                    if (occurrence.time !== undefined) {
                        recordSpan(deps, SPANS.longCallback.name, occurrence.time, occurrence.time + callback.durationMs, attributes);
                    }
                }
            },
            deps.clock,
            deps.logger,
            options,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}

/**
 * This function adds the long callback monitor to the monitors of
 * `setupAllMonitors`. The monitor gets the dependencies of the setup. Thus
 * its events have the ID of the page view, and its spans are in the span of
 * the page view. `monitors.stop()` removes the hook.
 *
 * ```ts
 * import { addCallbackHook } from "async-browser-context";
 * import { setupLongCallbacks } from "@mark1russell7/lag/async-context";
 *
 * const monitors = setupAllMonitors(createBrowserDeps(window, options));
 * setupLongCallbacks(monitors, addCallbackHook);
 * ```
 */
export function setupLongCallbacks(
    monitors : Pick<AllMonitorHandles, "add">,
    addCallbackHook : AddCallbackHookFn,
    options : LongCallbackOptions = {},
) : MonitorHandle<LongCallbackMonitor> {
    return monitors.add((deps) => createInstrumentedLongCallbacks({ ...deps, addCallbackHook }, options));
}

/**
 * The parts of `@opentelemetry/api` that `activeSpanName` uses. Give the
 * module itself: `import * as api from "@opentelemetry/api"`.
 */
export type OtelActiveSpanApiLike = {
    trace : { getActiveSpan() : object | undefined };
};

/**
 * This function gives an `operation` function for the long callback
 * monitor: the name of the active span of OpenTelemetry. The span of the SDK
 * has its name in the property `name`. A span without a name, for example a
 * span that the sampler did not record, gives `undefined`.
 *
 * ```ts
 * import * as api from "@opentelemetry/api";
 * setupLongCallbacks(monitors, addCallbackHook, { operation : activeSpanName(api) });
 * ```
 *
 * The active span stays correct through `await`, timers and listeners only
 * with a context manager that uses async-browser-context
 * (`AsyncContextManager` of `async-browser-context/opentelemetry`).
 */
export function activeSpanName(api : OtelActiveSpanApiLike) : () => string | undefined {
    return () => {
        const name : unknown = (api.trace.getActiveSpan() as { name? : unknown } | undefined)?.name;
        return typeof name === "string" ? name : undefined;
    };
}
