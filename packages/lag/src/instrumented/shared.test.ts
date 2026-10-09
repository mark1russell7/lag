import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandle, pageViewSpanOf, recordHangSpan, recordSpan, validatedRecorder, PAGE_VIEW_SPAN_ID, PAGE_VIEW_TRACE_ID } from "./shared.js";
import { createRecordingSpanSink, expectCatalogSpans } from "../test-utils.js";
import type { PageViewSpans } from "./page-view-spans.js";
import type { SpanIdentity } from "../spans.js";
import { createMeasurementConditions } from "../measurement-conditions.js";

describe("validatedRecorder", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records each sample at once with its window, without measurement conditions", () => {
        const record = vi.fn();
        const recorder = validatedRecorder(undefined, record);

        recorder.submit(12, 100);
        recorder.dispose();

        expect(record.mock.calls).toEqual([[12, 100]]);
    });

    it("gives each sample to a validator of the measurement conditions, and dispose() cancels the samples that wait", () => {
        const conditions = createMeasurementConditions({
            clock : { now : () => Date.now() },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
        });
        const record = vi.fn();
        const recorder = validatedRecorder(conditions, record);

        recorder.submit(12, 100);
        recorder.submit(9_000, 9_000);
        recorder.dispose();
        vi.advanceTimersByTime(5_000);

        expect(record.mock.calls).toEqual([[12, 100]]);
    });
});

describe("createHandle", () => {
    it("gives a handle with the monitor and the stop function of the build function", () => {
        const stop = vi.fn();
        const handle = createHandle("probe", { log : vi.fn() }, () => ({ monitor : "monitor", stop }));

        handle.stop();

        expect(handle).toMatchObject({ name : "probe", monitor : "monitor" });
        expect(stop).toHaveBeenCalledTimes(1);
    });
});

describe("the span helpers", () => {
    const THIS_VIEW : SpanIdentity = { traceId : "a".repeat(32), spanId : "b".repeat(16) };
    const HUNG_VIEW : SpanIdentity = { traceId : "c".repeat(32), spanId : "d".repeat(16) };
    const views = (current : SpanIdentity | undefined) : PageViewSpans => ({
        viewStarted : vi.fn(),
        viewHidden : vi.fn(),
        viewEnded : vi.fn(),
        current : () => current,
    });
    const hungPage = { "lag.page_view.id" : "v9", [PAGE_VIEW_TRACE_ID] : HUNG_VIEW.traceId, [PAGE_VIEW_SPAN_ID] : HUNG_VIEW.spanId };
    const hang = { startedAt : 1_000, durationMs : 6_000, attributes : { phase : "abandoned", duration_ms : 6_000 } };

    it("pageViewSpanOf reads the span of the page view from the context attributes, if it is valid", () => {
        expect(pageViewSpanOf(hungPage)).toEqual(HUNG_VIEW);
        expect(pageViewSpanOf({ "lag.page_view.id" : "v9" })).toBeUndefined();
        expect(pageViewSpanOf({ [PAGE_VIEW_TRACE_ID] : "x", [PAGE_VIEW_SPAN_ID] : HUNG_VIEW.spanId })).toBeUndefined();
    });

    it("puts the span of an abandoned hang into the trace of the page that hung, with a link to the view that reports it", () => {
        const sink = createRecordingSpanSink();
        recordHangSpan({ spans : sink, pageViewSpans : views(THIS_VIEW) }, { ...hang, hungPage });

        expect(sink.spans).toEqual([expect.objectContaining({
            name : "lag.main_thread.hang",
            startTime : 1_000,
            endTime : 7_000,
            attributes : { phase : "abandoned", duration_ms : 6_000 },
            parent : HUNG_VIEW,
            links : [THIS_VIEW],
        })]);
        expect(sink.spans[0]!.identity.traceId).toBe(HUNG_VIEW.traceId);
        expectCatalogSpans(sink.spans);
    });

    it("gives no link when the page that hung is this view, or when this page has no open view", () => {
        const sink = createRecordingSpanSink();
        recordHangSpan({ spans : sink, pageViewSpans : views(HUNG_VIEW) }, { ...hang, hungPage });
        recordHangSpan({ spans : sink, pageViewSpans : views(undefined) }, { ...hang, hungPage });
        recordHangSpan({ spans : sink }, { ...hang, hungPage });

        expect(sink.spans.map(span => [span.parent, span.links])).toEqual([[HUNG_VIEW, []], [HUNG_VIEW, []], [HUNG_VIEW, []]]);
    });

    it("puts a hang into the current view when the record of the page that hung has no span, or when there is no record", () => {
        const sink = createRecordingSpanSink();
        recordHangSpan({ spans : sink, pageViewSpans : views(THIS_VIEW) }, { ...hang, hungPage : { "lag.page_view.id" : "v9" } });
        recordHangSpan({ spans : sink, pageViewSpans : views(THIS_VIEW) }, hang);
        recordHangSpan({ spans : sink }, hang);

        expect(sink.spans.map(span => [span.parent, span.links])).toEqual([[THIS_VIEW, []], [THIS_VIEW, []], [undefined, []]]);
    });

    it("recordSpan records a span of a monitor in the current view, or as a new trace without an open view", () => {
        const sink = createRecordingSpanSink();
        recordSpan({ spans : sink, pageViewSpans : views(THIS_VIEW) }, "lag.stall", 10, 50, { kind : "macrotask", duration_ms : 40 });
        recordSpan({ spans : sink }, "lag.stall", 60, 70, { kind : "macrotask", duration_ms : 10 });

        expect(sink.spans.map(span => [span.startTime, span.endTime, span.parent])).toEqual([[10, 50, THIS_VIEW], [60, 70, undefined]]);
        expectCatalogSpans(sink.spans);
    });

    it("does nothing without a span sink", () => {
        const pageViewSpans = { ...views(THIS_VIEW), current : vi.fn(() => THIS_VIEW) };
        recordHangSpan({ pageViewSpans }, { ...hang, hungPage });
        recordSpan({ pageViewSpans }, "lag.stall", 10, 50, {});
        expect(pageViewSpans.current).not.toHaveBeenCalled();
    });
});
