import { describe, expect, it, vi } from "vitest";
import { createInstrumentedBrowserReports } from "./browser-reports.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";
import type { ReportingObserverInit, ReportLike } from "../BrowserReportMonitor.js";

function setup(withEvents : boolean) {
    let callback : ((reports : ReportLike[]) => void) | undefined;
    class FakeReportingObserver {
        constructor(cb : (reports : ReportLike[]) => void) { callback = cb; }
        observe() {}
        disconnect() {}
    }
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const logger = { log : vi.fn() };
    const handle = createInstrumentedBrowserReports({
        logger,
        clock : { now : () => 0 },
        meter : meter.meter,
        ReportingObserver : FakeReportingObserver as unknown as ReportingObserverInit,
        ...(withEvents ? { events } : {}),
    });
    const report = (type : string) : ReportLike => ({ type, url : "https://shop.example/", body : { id : "id", message : "message", sourceFile : "https://shop.example/app.js?v=3", lineNumber : 7 } });
    return { meter, events, logger, handle, emit : (...reports : ReportLike[]) => callback?.(reports), report };
}

describe("createInstrumentedBrowserReports", () => {
    it("counts each report by its type, and sends an event without the query of the source file", () => {
        const t = setup(true);

        t.emit(t.report("intervention"), t.report("deprecation"));

        expect(t.meter.records().get("lag_browser_reports")).toEqual([
            { value : 1, attributes : { type : "intervention" } },
            { value : 1, attributes : { type : "deprecation" } },
        ]);
        expect(t.events.emit).toHaveBeenCalledWith("lag.browser_report", {
            type : "intervention",
            id : "id",
            message : "message",
            source_file : "https://shop.example/app.js",
            line_number : 7,
        });
        expectCatalogInstruments(t.meter);
        expectCatalogEvents(t.events.emit);
    });

    it("sends no more than 10 events each minute, but counts all reports", () => {
        const t = setup(true);

        t.emit(...Array.from({ length : 12 }, () => t.report("intervention")));

        expect(t.meter.sum("lag_browser_reports")).toBe(12);
        expect(t.events.emit).toHaveBeenCalledTimes(10);
    });

    it("counts the reports without an event sink", () => {
        const t = setup(false);

        t.emit(t.report("intervention"));

        expect(t.meter.sum("lag_browser_reports")).toBe(1);
        expect(t.logger.log).not.toHaveBeenCalled();
    });
});
