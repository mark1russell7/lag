/**
 * The source kinds of the callbacks: a closed set of values for the
 * attribute `source_kind` of the metric `lag_long_callback_duration_histogram`.
 *
 * The callback hook of async-browser-context gives the API that got each
 * callback as `source`, for example `"setTimeout"`,
 * `"addEventListener:click"` or `"await"`. The source of an event can have
 * each event type, thus it is not an attribute of a metric. The source kind
 * is the group of the API. It has 9 values.
 */
export const CALLBACK_SOURCE_KINDS = ["timer", "promise", "event", "await", "observer", "stream", "lock", "frame", "other"] as const;

/** One source kind of a callback (refer to `CALLBACK_SOURCE_KINDS`). */
export type CallbackSourceKind = typeof CALLBACK_SOURCE_KINDS[number];

/**
 * The source kind of each source that has a fixed name in async-browser-context
 * 0.2. The events, the `on...` properties and the streams have a pattern
 * (refer to `callbackSourceKind`).
 */
const KIND_OF_SOURCE : ReadonlyMap<string, CallbackSourceKind> = new Map<string, CallbackSourceKind>([
    ["await", "await"],
    // The microtasks
    ["Promise.then", "promise"],
    ["queueMicrotask", "promise"],
    // The tasks of the timers and of the schedulers
    ["setTimeout", "timer"],
    ["setInterval", "timer"],
    ["setImmediate", "timer"],
    ["requestIdleCallback", "timer"],
    ["Scheduler.postTask", "timer"],
    // The callbacks of the rendering steps
    ["requestAnimationFrame", "frame"],
    ["XRSession.requestAnimationFrame", "frame"],
    ["HTMLVideoElement.requestVideoFrameCallback", "frame"],
    ["Document.startViewTransition", "frame"],
    ["NavigateEvent.intercept", "event"],
    ["LockManager.request", "lock"],
    ["MutationObserver", "observer"],
    ["WebKitMutationObserver", "observer"],
    ["ResizeObserver", "observer"],
    ["IntersectionObserver", "observer"],
    ["PerformanceObserver", "observer"],
    ["ReportingObserver", "observer"],
    ["PressureObserver", "observer"],
    ["FinalizationRegistry", "observer"],
]);

/**
 * This function gives the source kind of the source of a callback:
 *
 * - `event` for `addEventListener:<type>`, for an `on...` property (for
 *   example `onclick`) and for `NavigateEvent.intercept`.
 * - `stream` for a method of the underlying object of a stream, for example
 *   `ReadableStream.pull`.
 * - The kind of the table for a source with a fixed name, for example
 *   `timer` for `setTimeout` and `promise` for `Promise.then` and
 *   `queueMicrotask`.
 * - `other` for each other source, for example `Geolocation.watchPosition`,
 *   and for a source of a later version of the library.
 */
export function callbackSourceKind(source : string) : CallbackSourceKind {
    const kind = KIND_OF_SOURCE.get(source);
    if (kind) return kind;
    if (source.startsWith("addEventListener:") || /^on[a-z]+$/.test(source)) return "event";
    if (/^(Readable|Writable|Transform)Stream\.[a-z]+$/.test(source)) return "stream";
    return "other";
}
