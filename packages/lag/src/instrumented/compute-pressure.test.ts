import { describe, expect, it, vi } from "vitest";
import { createInstrumentedComputePressure } from "./compute-pressure.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";
import type { PressureObserverInit, PressureRecord, PressureSource } from "../ComputePressureMonitor.js";

function setup(options : { pressureSources? : PressureSource[]; pressureSampleIntervalMs? : number } = {}) {
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
    const handle = createInstrumentedComputePressure({
        logger : { log : vi.fn() },
        clock : { now : () => 0 },
        meter : meter.meter,
        PressureObserver : FakePressureObserver as unknown as PressureObserverInit,
        ...options,
    });
    return { observed, meter, handle, emit : (records : PressureRecord[]) => callback?.(records) };
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

    it("observes the sources and the sample interval of the dependencies", () => {
        const t = setup({ pressureSources : ["thermals"], pressureSampleIntervalMs : 5_000 });
        t.handle.stop();

        expect(t.observed).toEqual([{ source : "thermals", options : { sampleInterval : 5_000 } }]);
    });
});
