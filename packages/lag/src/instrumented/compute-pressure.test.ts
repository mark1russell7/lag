import { describe, expect, it, vi } from "vitest";
import { createInstrumentedComputePressure } from "./compute-pressure.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";
import type { PressureObserverInit, PressureRecord, PressureSource } from "../ComputePressureMonitor.js";

function setup(options : { pressureSources? : PressureSource[]; pressureSampleIntervalMs? : number } = {}, withEvents = false) {
    const observed : Array<{ source : PressureSource; options : unknown }> = [];
    let callback : ((records : PressureRecord[]) => void) | undefined;
    class FakePressureObserver {
        constructor(cb : (records : PressureRecord[]) => void) { callback = cb; }
        observe(source : PressureSource, observeOptions? : unknown) {
            observed.push({ source, options : observeOptions });
            return Promise.resolve();
        }
        disconnect() {}
        takeRecords() { return []; }
    }
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const handle = createInstrumentedComputePressure({
        logger : { log : vi.fn() },
        clock : { now : () => 0 },
        meter : meter.meter,
        PressureObserver : FakePressureObserver as unknown as PressureObserverInit,
        performance : { timeOrigin : 1_000_000, now : () => 0 },
        ...(withEvents ? { events } : {}),
        ...options,
    });
    return { observed, meter, events, handle, emit : (records : PressureRecord[]) => callback?.(records) };
}

describe("createInstrumentedComputePressure", () => {
    it("observes the cpu source each second by default, and records the state ordinal with the source", () => {
        const t = setup();

        t.emit([{ source : "cpu", state : "serious", time : 1_000 }]);
        t.handle.stop();

        expect(t.observed).toEqual([{ source : "cpu", options : { sampleInterval : 1_000 } }]);
        expect(t.meter.records().get("lag_pressure_state_histogram")).toEqual([{ value : 2, attributes : { source : "cpu" } }]);
        expectCatalogInstruments(t.meter);
    });

    it("emits an event for each change of the state of a source, at the time of the record", () => {
        const t = setup({ pressureSources : ["cpu", "thermals"] }, true);

        t.emit([{ source : "cpu", state : "nominal", time : 1_000 }]);
        t.emit([{ source : "cpu", state : "nominal", time : 2_000 }, { source : "thermals", state : "fair", time : 2_000 }]);
        t.emit([{ source : "cpu", state : "critical", time : 3_000 }]);
        t.handle.stop();

        // Each record goes into the histogram, but a record with the same state emits no event
        expect(t.meter.values("lag_pressure_state_histogram")).toEqual([0, 0, 1, 3]);
        expect(t.events.emit.mock.calls).toEqual([
            ["lag.pressure.change", { source : "cpu", state : "nominal" }, { time : 1_001_000 }],
            ["lag.pressure.change", { source : "thermals", state : "fair" }, { time : 1_002_000 }],
            ["lag.pressure.change", { source : "cpu", state : "critical", previous_state : "nominal" }, { time : 1_003_000 }],
        ]);
        expectCatalogEvents(t.events.emit);
    });

    it("observes the sources and the sample interval of the dependencies", () => {
        const t = setup({ pressureSources : ["thermals"], pressureSampleIntervalMs : 5_000 });
        t.handle.stop();

        expect(t.observed).toEqual([{ source : "thermals", options : { sampleInterval : 5_000 } }]);
    });
});
