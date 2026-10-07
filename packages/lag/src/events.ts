import type { AttributeValue } from "./meter.js";

export type EventAttributes = Readonly<Record<string, AttributeValue>>;

/**
 * The port for structured events. Events carry the high-cardinality details
 * that metrics must not carry, for example a page view ID or the CSS
 * selector of an interaction target. The OpenTelemetry adapter
 * (`createOtelEventSink`) sends each event as a log record with an event name.
 */
export type EventSink = {
    emit(name : string, attributes : EventAttributes) : void;
};

export function createNoopEventSink() : EventSink {
    return { emit() {} };
}
