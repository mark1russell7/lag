import type { AttributeValue } from "./meter.js";

export type EventAttributes = Readonly<Record<string, AttributeValue>>;

/** The options of one event. */
export type EventOptions = {
    /**
     * The time of the occurrence, in Unix milliseconds. For an event with a
     * duration, it is the start. The monitors calculate it from their
     * absolute clock (`createAbsoluteClock`), because the OpenTelemetry SDK
     * gives the metric points times on the same clock. Thus an event and a
     * metric point of the same time are at the same place on a chart.
     * Without a time, the sink uses the time of the call.
     */
    time? : number;
};

/**
 * The port for structured events. Events carry the high-cardinality details
 * that metrics must not carry, for example a page view ID or the CSS
 * selector of an interaction target. The OpenTelemetry adapter
 * (`createOtelEventSink`) sends each event as a log record with an event name.
 * The time of the occurrence (`options.time`) becomes the time of the log
 * record. The time of the call becomes its observed time.
 */
export type EventSink = {
    emit(name : string, attributes : EventAttributes, options? : EventOptions) : void;
};

/**
 * The maximum distance from the time of the call to the time of an
 * occurrence. Within it, the time of the occurrence becomes the time of the
 * record. Loki keeps the events of one name in one stream for all pages of a
 * service. It rejects a record that is older than the newest record of its
 * stream by more than `max_chunk_age / 2` (1 hour by default). An LCP that
 * the page reports when it becomes hidden can be some hours old.
 */
export const MAX_EVENT_TIME_OFFSET_MS : number = 30 * 60_000;

/** The attribute that keeps the time of an occurrence that is too far from the time of the call. */
export const EVENT_TIME_ATTRIBUTE = "lag.event.time";

/**
 * This function gives the time of the record of an occurrence at `time`
 * that a sink sends at `now` (Unix milliseconds):
 * - `time`, when it is no more than `maxOffsetMs` before or after `now`.
 * - Otherwise, no time: the record gets the time of the call. Then
 *   `attributes` has `lag.event.time` with the time of the occurrence.
 * - No time and no attribute for an unknown time or a time that is not a
 *   finite number.
 */
export function placeEventTime(
    time : number | undefined,
    now : number,
    maxOffsetMs : number = MAX_EVENT_TIME_OFFSET_MS,
) : { timestamp : number | undefined; attributes : EventAttributes } {
    if (time === undefined || !Number.isFinite(time)) return { timestamp : undefined, attributes : {} };
    if (Math.abs(now - time) <= maxOffsetMs) return { timestamp : time, attributes : {} };
    return { timestamp : undefined, attributes : { [EVENT_TIME_ATTRIBUTE] : time } };
}

export function createNoopEventSink() : EventSink {
    return { emit() {} };
}

/**
 * An event sink that adds the attributes from `context` to each event, for
 * example the ID of the current page view. The attributes of the event have
 * priority over the context attributes.
 */
export function withEventContext(sink : EventSink, context : () => EventAttributes) : EventSink {
    // The options go to the sink only when the caller gave them
    return { emit : (name, attributes, ...options) => sink.emit(name, { ...context(), ...attributes }, ...options) };
}
