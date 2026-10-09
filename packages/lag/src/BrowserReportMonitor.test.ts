import { describe, expect, it, vi } from "vitest";
import { BrowserReportMonitor, type BrowserReport, type ReportingObserverInit, type ReportLike } from "./BrowserReportMonitor.js";

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

/**
 * A fake of the Reporting API as the specification tells: the global keeps
 * each report in a buffer, and `observe()` of an observer with
 * `buffered: true` delivers the reports of the buffer again.
 */
function createSpecReporting() {
    const buffer : ReportLike[] = [];
    const connected = new Set<{ deliver : (reports : ReportLike[]) => void }>();
    class SpecReportingObserver {
        private readonly entry : { deliver : (reports : ReportLike[]) => void };
        constructor(callback : (reports : ReportLike[]) => void, private readonly options? : { buffered? : boolean }) {
            this.entry = { deliver : callback };
        }
        observe() {
            connected.add(this.entry);
            if (this.options?.buffered) this.entry.deliver([...buffer]);
        }
        disconnect() {
            connected.delete(this.entry);
        }
    }
    return {
        Ctor : SpecReportingObserver as unknown as ReportingObserverInit,
        queueReport(report : ReportLike) {
            buffer.push(report);
            for (const entry of connected) entry.deliver([report]);
        },
    };
}

describe("BrowserReportMonitor", () => {
    it("gets the reports from before its start, and after stop() and start() no report a second time", () => {
        const reporting = createSpecReporting();
        const report = vi.fn();
        reporting.queueReport({ type : "intervention", url : "", body : { id : "before-start" } });

        const monitor = new BrowserReportMonitor(report, { log : vi.fn() }, reporting.Ctor);
        reporting.queueReport({ type : "deprecation", url : "", body : { id : "first" } });
        monitor.stop();
        reporting.queueReport({ type : "deprecation", url : "", body : { id : "while-stopped" } });
        monitor.start();
        reporting.queueReport({ type : "deprecation", url : "", body : { id : "after-restart" } });

        expect(report.mock.calls.map(c => (c[0] as BrowserReport).id)).toEqual(["before-start", "first", "after-restart"]);
    });

    it("asks for the buffered reports again when the first start failed", () => {
        const o = createObserver();
        let fail = true;
        const Flaky = class {
            constructor(cb : (reports : ReportLike[]) => void, opts : unknown) {
                if (fail) throw new Error("no");
                return new (o.Ctor as unknown as new (cb : unknown, opts : unknown) => object)(cb, opts);
            }
        } as unknown as ReportingObserverInit;
        const monitor = new BrowserReportMonitor(vi.fn(), { log : vi.fn() }, Flaky);
        fail = false;
        monitor.start();
        expect(o.options).toHaveBeenCalledWith({ types : ["intervention", "deprecation"], buffered : true });
    });

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

    it("disconnects on stop and can start again, without the buffered reports", () => {
        const o = createObserver();
        const monitor = new BrowserReportMonitor(vi.fn(), { log : vi.fn() }, o.Ctor);
        monitor.stop();
        expect(o.disconnect).toHaveBeenCalled();
        monitor.start();
        expect(o.observe).toHaveBeenCalledTimes(2);
        expect(o.options.mock.calls).toEqual([
            [{ types : ["intervention", "deprecation"], buffered : true }],
            [{ types : ["intervention", "deprecation"], buffered : false }],
        ]);
    });

    it("start() while the monitor observes makes no second observer, and stop() works after a start that failed", () => {
        const o = createObserver();
        const monitor = new BrowserReportMonitor(vi.fn(), { log : vi.fn() }, o.Ctor);
        monitor.start();
        expect(o.options).toHaveBeenCalledTimes(1);

        const failing = new BrowserReportMonitor(vi.fn(), { log : vi.fn() }, class { constructor() { throw new Error("no"); } } as unknown as ReportingObserverInit);
        expect(() => failing.stop()).not.toThrow();
    });

    it("names the error and the monitor in its logs", () => {
        const logger = { log : vi.fn() };
        new BrowserReportMonitor(vi.fn(), logger, class { constructor() { throw new Error("no"); } } as unknown as ReportingObserverInit);
        const o = createObserver();
        new BrowserReportMonitor(() => { throw new Error("boom"); }, logger, o.Ctor);
        o.emit([{ type : "intervention", url : "https://shop.example/", body : {} }]);

        expect(logger.log.mock.calls).toEqual([
            ["warn", "ReportingObserver not available in this browser.", { error : expect.any(Error), type : "BrowserReportMonitor" }],
            ["error", "Error processing browser report.", { error : expect.any(Error), type : "BrowserReportMonitor" }],
        ]);
    });
});
