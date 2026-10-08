import { expect } from "vitest";
import { ComputePressureMonitor, type PressureMeasurement, type PressureObserverInit } from "@lag/core";
import { cdp } from "../commands.js";
import { createRecordingLogger, waitUntil } from "../harness.js";

/**
 * The Compute Pressure API with a virtual CPU source (CDP
 * Emulation.setPressureSourceOverrideEnabled). The real source reports the
 * state of this machine, and only to a page that passes the privacy test,
 * so its records are not deterministic.
 */
describe("ComputePressureMonitor with a virtual CPU pressure source", () => {
    afterEach(async () => {
        await cdp.resetPage();
    });

    it("records each state of the source, as ordinals 0 to 3", async () => {
        await cdp.setPressureState("nominal");
        const measurements : PressureMeasurement[] = [];
        const logger = createRecordingLogger();
        const PressureObserver = (globalThis as unknown as { PressureObserver : PressureObserverInit }).PressureObserver;
        const monitor = new ComputePressureMonitor(["cpu"], (m) => measurements.push(m), logger, PressureObserver, 100);
        try {
            const states : PressureMeasurement["state"][] = ["nominal", "serious", "critical", "fair"];
            for (const state of states) {
                await cdp.setPressureState(state);
                expect(await waitUntil(() => measurements.at(-1)?.state === state, 3_000), `state ${state}, got ${JSON.stringify(measurements)}`).toBe(true);
            }
            console.log(`Pressure records: ${measurements.map(m => `${m.state}=${m.stateOrdinal}`).join(", ")}`);
            expect(logger.messages).toEqual([]);
            expect(measurements.map(m => m.source)).toEqual(measurements.map(() => "cpu"));
            expect([...new Set(measurements.map(m => `${m.state}=${m.stateOrdinal}`))]).toEqual(["nominal=0", "serious=2", "critical=3", "fair=1"]);
            expect(monitor.getCurrentState("cpu")).toBe("fair");
            expect(monitor.getWorstStateOrdinal()).toBe(1);
        } finally {
            monitor.stop();
        }
    });
});
