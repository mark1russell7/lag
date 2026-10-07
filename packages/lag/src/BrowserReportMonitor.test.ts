import { describe, expect, it, vi } from "vitest";
import { BrowserReportMonitor, type ReportingObserverInit, type ReportLike } from "./BrowserReportMonitor.js";

function createObserver() {
    let callback : ((reports : ReportLike[]) => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const options = vi.fn();
    class FakeReportingObserver {
        constructor(cb : (reports : ReportLike[]) => void, opts : unknown) {
            callback = cb;
            options(opts);
        }
        observe = observe;
        disconnect = disconnect;
    }
    return {
        Ctor : FakeReportingObserver as unknown as ReportingObserverInit,
        emit : (reports : ReportLike[]) => callback?.(reports),
        observe,
        disconnect,
        options,
    };
}

describe("BrowserReportMonitor", () => {
    it("observes interventions and deprecations, including buffered reports", () => {
        const o = createObserver();
        new BrowserReportMonitor(vi.fn(), { log : vi.fn() }, o.Ctor);
        expect(o.observe).toHaveBeenCalled();
        expect(o.options).toHaveBeenCalledWith({ types : ["intervention", "deprecation"], buffered : true });
    });

    it("reports the fields of each report body", () => {
        const o = createObserver();
        const report = vi.fn();
        new BrowserReportMonitor(report, { log : vi.fn() }, o.Ctor);

        o.emit([
            { type : "intervention", url : "https://x", body : { id : "HeavyAdIntervention", message : "Ad removed", sourceFile : "https://x/a.js", lineNumber : 3 } },
            { type : "deprecation", url : "https://x", body : null },
            { type : "csp-violation", url : "https://x", body : {} },
        ]);

        expect(report.mock.calls.map(c => c[0])).toEqual([
            { type : "intervention", id : "HeavyAdIntervention", message : "Ad removed", sourceFile : "https://x/a.js", lineNumber : 3 },
            { type : "deprecation", id : "", message : "", sourceFile : "", lineNumber : 0 },
        ]);
    });

    it("logs a warning when ReportingObserver is not available", () => {
        const logger = { log : vi.fn() };
        const Throwing = class { constructor() { throw new Error("no"); } } as unknown as ReportingObserverInit;
        new BrowserReportMonitor(vi.fn(), logger, Throwing);
        expect(logger.log).toHaveBeenCalledWith("warn", "ReportingObserver not available in this browser.", expect.anything());
    });

    it("isolates a report callback that throws", () => {
        const o = createObserver();
        const logger = { log : vi.fn() };
        const report = vi.fn().mockImplementationOnce(() => { throw new Error("boom"); });
        new BrowserReportMonitor(report, logger, o.Ctor);

        o.emit([
            { type : "intervention", url : "", body : {} },
            { type : "deprecation", url : "", body : {} },
        ]);

        expect(report).toHaveBeenCalledTimes(2);
        expect(logger.log).toHaveBeenCalledWith("error", "Error processing browser report.", expect.anything());
    });

    it("disconnects on stop and can start again", () => {
        const o = createObserver();
        const monitor = new BrowserReportMonitor(vi.fn(), { log : vi.fn() }, o.Ctor);
        monitor.stop();
        expect(o.disconnect).toHaveBeenCalled();
        monitor.start();
        expect(o.observe).toHaveBeenCalledTimes(2);
    });
});
