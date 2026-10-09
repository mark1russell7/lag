import type { AttributeValue } from "./meter.js";
import type { EventAttributes } from "./events.js";
import type { OpenSpan, SpanIdentity, SpanOptions, SpanSink } from "./spans.js";

/** The parts of an OpenTelemetry `SpanContext` that the adapter uses. */
export type OtelSpanContext = {
    traceId : string;
    spanId : string;
    traceFlags : number;
    isRemote? : boolean;
};

/** The parts of an OpenTelemetry `Span` that the adapter uses. */
export type OtelSpanLike = {
    spanContext() : OtelSpanContext;
    setAttributes(attributes : Record<string, AttributeValue>) : unknown;
    end(endTime? : number) : void;
};

/** The parts of an OpenTelemetry `Tracer` that the adapter uses. */
export type OtelTracerLike = {
    startSpan(
        name : string,
        options? : {
            startTime? : number;
            attributes? : Record<string, AttributeValue>;
            links? : Array<{ context : OtelSpanContext }>;
        },
        context? : unknown,
    ) : OtelSpanLike;
};

/**
 * The parts of `@opentelemetry/api` that the adapter uses to give a span its
 * parent. Give the module itself: `import * as api from "@opentelemetry/api"`.
 */
export type OtelTraceApiLike = {
    trace : { setSpanContext(context : unknown, spanContext : OtelSpanContext) : unknown };
    ROOT_CONTEXT : unknown;
};

/** The trace flag "sampled". */
const SAMPLED = 1;

function contextOf(identity : SpanIdentity) : OtelSpanContext {
    // A parent can be a span of another page (for example a hang that another page reports).
    // The sampler of the SDK then samples the span as its parent.
    return { traceId : identity.traceId, spanId : identity.spanId, traceFlags : identity.sampled === false ? 0 : SAMPLED, isRemote : true };
}

function clean(attributes : EventAttributes | undefined) : Record<string, AttributeValue> {
    const result : Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
        if (value !== undefined && value !== null) result[key] = value;
    }
    return result;
}

/**
 * This function makes a span sink that sends each span through an
 * OpenTelemetry tracer. Each span has the start and the end of the period
 * that the monitor measured. The parent is the root context, or the span of
 * `options.parent`. The sink removes the attributes that have no value.
 *
 * ```ts
 * import * as api from "@opentelemetry/api";
 * const spans = createOtelSpanSink(api.trace.getTracer("lag"), api);
 * ```
 */
export function createOtelSpanSink(tracer : OtelTracerLike, api : OtelTraceApiLike) : SpanSink {
    const startSpan = (name : string, options : SpanOptions) : OtelSpanLike => {
        const parent = options.parent ? api.trace.setSpanContext(api.ROOT_CONTEXT, contextOf(options.parent)) : api.ROOT_CONTEXT;
        const links = (options.links ?? []).map(identity => ({ context : contextOf(identity) }));
        return tracer.startSpan(name, {
            startTime : options.startTime,
            attributes : clean(options.attributes),
            ...(links.length > 0 ? { links } : {}),
        }, parent);
    };
    return {
        start(name, options) : OpenSpan {
            const span = startSpan(name, options);
            const { traceId, spanId, traceFlags } = span.spanContext();
            let ended = false;
            return {
                identity : { traceId, spanId, ...((traceFlags & SAMPLED) === SAMPLED ? {} : { sampled : false }) },
                setAttributes : (attributes) => { if (!ended) span.setAttributes(clean(attributes)); },
                end : (endTime) => {
                    if (ended) return;
                    ended = true;
                    span.end(endTime);
                },
            };
        },
        record(name, options) {
            startSpan(name, options).end(options.endTime);
        },
    };
}
