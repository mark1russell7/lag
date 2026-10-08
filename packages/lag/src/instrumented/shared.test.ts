import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandle, validatedRecorder } from "./shared.js";
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
