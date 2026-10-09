import { describe, expect, it, vi } from "vitest";
import { createNoopSpanSink, isSpanIdentity } from "./spans.js";
import { createOtelSpanSink, type OtelSpanContext, type OtelTraceApiLike } from "./otel-span-adapter.js";
import { createPageViewSpans } from "./instrumented/page-view-spans.js";
import { createRecordingSpanSink } from "./test-utils.js";
import type { PageView } from "./vitals/ViewCollector.js";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const SPAN = "b7ad6b7169203331";

describe("createNoopSpanSink", () => {
    it("records nothing, and its spans have no identity", () => {
        const sink = createNoopSpanSink();
        const span = sink.start("a", { startTime : 1 });
        span.setAttributes({ x : 1 });
        span.end(2);
        sink.record("b", { startTime : 1, endTime : 2 });
        expect(span.identity).toBeUndefined();
    });
});

describe("isSpanIdentity", () => {
    it("accepts the trace ID and the span ID of the W3C trace context", () => {
        expect(isSpanIdentity({ traceId : TRACE, spanId : SPAN })).toBe(true);
    });

    it("rejects missing, malformed and all-zero IDs", () => {
        for (const value of [
            undefined,
            {},
            { traceId : TRACE },
            { traceId : TRACE.toUpperCase(), spanId : SPAN },
            { traceId : TRACE.slice(1), spanId : SPAN },
            { traceId : "0".repeat(32), spanId : SPAN },
            { traceId : TRACE, spanId : "0".repeat(16) },
            { traceId : TRACE, spanId : 7 },
        ]) {
            expect(isSpanIdentity(value as never), JSON.stringify(value)).toBe(false);
        }
    });
});

describe("createOtelSpanSink", () => {
    function setup() {
        const started : Array<{ name : string; options : unknown; context : unknown; ended : unknown[]; attributes : unknown[] }> = [];
        let n = 0;
        const tracer = {
            startSpan : (name : string, options? : unknown, context? : unknown) => {
                n++;
                const entry = { name, options, context, ended : [] as unknown[], attributes : [] as unknown[] };
                started.push(entry);
                const spanContext : OtelSpanContext = { traceId : TRACE, spanId : n.toString(16).padStart(16, "0"), traceFlags : 1 };
                return {
                    spanContext : () => spanContext,
                    setAttributes : (attributes : unknown) => { entry.attributes.push(attributes); },
                    end : (endTime? : unknown) => { entry.ended.push(endTime); },
                };
            },
        };
        const api : OtelTraceApiLike = {
            ROOT_CONTEXT : "root",
            trace : { setSpanContext : vi.fn((context : unknown, spanContext : OtelSpanContext) => ({ context, spanContext })) },
        };
        return { started, sink : createOtelSpanSink(tracer, api), api };
    }

    it("starts an open span at its start time in the root context, without the attributes that have no value", () => {
        const t = setup();
        const span = t.sink.start("lag.page_view", { startTime : 1_000, attributes : { a : 1, gone : undefined as never, none : null as never } });

        expect(span.identity).toEqual({ traceId : TRACE, spanId : "0000000000000001" });
        expect(t.started[0]).toMatchObject({ name : "lag.page_view", options : { startTime : 1_000, attributes : { a : 1 } }, context : "root" });
        span.setAttributes({ "lag.web_vital.lcp" : 900 });
        span.end(5_000);
        span.end(6_000);
        span.setAttributes({ late : 1 });
        expect(t.started[0]!.attributes).toEqual([{ "lag.web_vital.lcp" : 900 }]);
        expect(t.started[0]!.ended).toEqual([5_000]);
    });

    it("records an ended span in the context of its parent, sampled and remote, with its links", () => {
        const t = setup();
        const parent = { traceId : TRACE, spanId : SPAN };
        const link = { traceId : "1".repeat(32), spanId : "2".repeat(16) };
        t.sink.record("lag.main_thread.hang", { startTime : 10, endTime : 20, parent, links : [link] });

        const remote = { traceId : TRACE, spanId : SPAN, traceFlags : 1, isRemote : true };
        expect(t.api.trace.setSpanContext).toHaveBeenCalledWith("root", remote);
        expect(t.started[0]).toMatchObject({
            options : { startTime : 10, links : [{ context : { ...link, traceFlags : 1, isRemote : true } }] },
            context : { context : "root", spanContext : remote },
        });
        expect(t.started[0]!.ended).toEqual([20]);
    });

    it("gives an unsampled span the identity sampled: false, and its children the context of an unsampled parent", () => {
        const t = setup();
        const tracer = {
            startSpan : (name : string, options? : unknown, context? : unknown) => {
                t.started.push({ name, options, context, ended : [], attributes : [] });
                return { spanContext : () => ({ traceId : TRACE, spanId : SPAN, traceFlags : 0 }), setAttributes() {}, end() {} };
            },
        };
        const sink = createOtelSpanSink(tracer, t.api);
        const view = sink.start("lag.page_view", { startTime : 1 });
        sink.record("lag.stall", { startTime : 2, endTime : 3, parent : view.identity! });

        expect(view.identity).toEqual({ traceId : TRACE, spanId : SPAN, sampled : false });
        expect(t.api.trace.setSpanContext).toHaveBeenCalledWith("root", { traceId : TRACE, spanId : SPAN, traceFlags : 0, isRemote : true });
    });

    it("gives no links option to a span without links", () => {
        const t = setup();
        t.sink.record("lag.stall", { startTime : 1, endTime : 2 });
        expect(t.started[0]!.options).not.toHaveProperty("links");
    });
});

describe("createPageViewSpans", () => {
    const view = (id : string, startTime : number, url? : string) : PageView => ({
        id,
        navigationType : startTime === 0 ? "navigate" : "back-forward-cache",
        startTime,
        ...(url ? { url } : {}),
    });
    const clock = { origin : 1_000_000, now : () => 1_060_000, monotonic : () => 60_000 };

    it("starts the span of a view at its start, and ends it at the final report with the values of the vitals", () => {
        const sink = createRecordingSpanSink();
        const spans = createPageViewSpans(sink, clock);
        const load = view("v1", 0, "https://shop.example/cart");
        spans.viewStarted(load);
        spans.viewStarted(load);
        expect(spans.current()).toEqual(sink.spans[0]!.identity);

        spans.viewEnded(load, [{ name : "LCP", value : 900, attribution : {} }, { name : "CLS", value : 0.05, attribution : {} }]);

        expect(sink.spans).toEqual([expect.objectContaining({
            name : "lag.page_view",
            startTime : 1_000_000,
            endTime : 1_060_000,
            attributes : {
                "lag.page_view.id" : "v1",
                navigation_type : "navigate",
                "lag.page_view.url" : "https://shop.example/cart",
                "lag.web_vital.lcp" : 900,
                "lag.web_vital.cls" : 0.05,
            },
        })]);
        expect(spans.current()).toBeUndefined();
    });

    it("ends the span of a view at the start of the next view, and ignores the end of a view that is not open", () => {
        const sink = createRecordingSpanSink();
        const spans = createPageViewSpans(sink, clock);
        spans.viewStarted(view("v1", 0));
        spans.viewStarted(view("v2", 30_000));
        spans.viewEnded(view("v1", 0), []);

        expect(sink.spans.map(span => [span.attributes["lag.page_view.id"], span.startTime, span.endTime])).toEqual([
            ["v1", 1_000_000, 1_030_000],
            ["v2", 1_030_000, undefined],
        ]);
    });

    it("uses Date.now() without a clock", () => {
        vi.useFakeTimers({ now : 5_000 });
        const sink = createRecordingSpanSink();
        const spans = createPageViewSpans(sink, undefined);
        spans.viewStarted(view("v1", 0));
        vi.advanceTimersByTime(100);
        spans.viewEnded(view("v1", 0), []);
        expect([sink.spans[0]!.startTime, sink.spans[0]!.endTime]).toEqual([5_000, 5_100]);
        vi.useRealTimers();
    });
});
