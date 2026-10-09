import type { EventAttributes } from "./events.js";

/**
 * The identity of a span, as in the W3C trace context. A span can have
 * another span as its parent, or refer to it with a link.
 */
export type SpanIdentity = {
    /** 32 hexadecimal characters. */
    readonly traceId : string;
    /** 16 hexadecimal characters. */
    readonly spanId : string;
    /**
     * False when the sampler of the SDK did not sample the span. Then the
     * spans in it are not sampled either. Undefined means sampled.
     */
    readonly sampled? : boolean;
};

/** The options of a span. The times are Unix milliseconds, as the times of the events. */
export type SpanOptions = {
    startTime : number;
    attributes? : EventAttributes;
    /** The parent of the span. Without a parent, the span starts a new trace. */
    parent? : SpanIdentity;
    /** Other spans that the span refers to, for example the page view that reported an abandoned hang. */
    links? : readonly SpanIdentity[];
};

/** A span that started and did not end, for example a page view. */
export type OpenSpan = {
    /** The identity of the span. It is undefined when the sink makes no identities (`createNoopSpanSink`). */
    readonly identity : SpanIdentity | undefined;
    setAttributes(attributes : EventAttributes) : void;
    /** This method ends the span at `endTime` (Unix milliseconds). A second call does nothing. */
    end(endTime : number) : void;
};

/**
 * The port for spans: the periods that the monitors measure, with their
 * real start and end. A page view is a span that stays open until the view
 * ends. A hang, a stall, a long animation frame and a hidden period are
 * spans in the page view. Thus a trace viewer shows each page view as a
 * timeline. The OpenTelemetry adapter is `createOtelSpanSink`.
 */
export type SpanSink = {
    /** This method starts a span that stays open until `end()`. */
    start(name : string, options : SpanOptions) : OpenSpan;
    /** This method records a span that ended already, for example a hang. */
    record(name : string, options : SpanOptions & { endTime : number }) : void;
};

/** A sink that records nothing. Its spans have no identity. */
export function createNoopSpanSink() : SpanSink {
    return {
        start : () => ({ identity : undefined, setAttributes() {}, end() {} }),
        record() {},
    };
}

/** True when `value` is a span identity: a trace ID of 32 and a span ID of 16 hexadecimal characters, not all zeros. */
export function isSpanIdentity(value : { traceId? : unknown; spanId? : unknown } | undefined) : value is SpanIdentity {
    const { traceId, spanId } = value ?? {};
    return typeof traceId === "string" && /^[0-9a-f]{32}$/.test(traceId) && !/^0+$/.test(traceId)
        && typeof spanId === "string" && /^[0-9a-f]{16}$/.test(spanId) && !/^0+$/.test(spanId);
}
