import { describe, expect, it } from "vitest";
import { CORRECTNESS_CASES, type CorrectnessResult, type SetupId } from "../shared/types.js";
import { describeScript, summarize, type Engine, type RunResult } from "./summary.js";

const allKept = Object.fromEntries(CORRECTNESS_CASES.map(name => [name, true])) as CorrectnessResult;

function run(engine : Engine, setup : SetupId, round : number, metrics : Record<string, number>, correctness : Partial<CorrectnessResult> = {}) : RunResult {
    return {
        engine,
        round,
        position : 0,
        setup,
        facts : { setup, contextManager : "stack", zoneLoaded : false, asyncContextInstalled : false, userAgent : "test" },
        metrics,
        loafScripts : [{ invoker : "TimerHandler:setTimeout", invokerType : "user-callback", sourceFunctionName : `${setup}-fn`, sourceURL : "", duration : 150 }],
        correctness : { ...allKept, ...correctness },
        otlpRequests : 0,
        errors : [],
    };
}

describe("summarize", () => {
    const runs = [
        run("chromium", "A", 0, { "workload.fetch.totalMs" : 100, "drift.medianMs" : 0.5 }),
        run("chromium", "A", 1, { "workload.fetch.totalMs" : 200, "drift.medianMs" : 0.7 }),
        run("chromium", "A", 2, { "workload.fetch.totalMs" : 150, "drift.medianMs" : 0.6 }),
        run("chromium", "C", 0, { "workload.fetch.totalMs" : 150, "drift.medianMs" : 0.5 }, { await : false }),
        run("chromium", "C", 1, { "workload.fetch.totalMs" : 220, "drift.medianMs" : 1.7 }),
        run("chromium", "C", 2, { "workload.fetch.totalMs" : 300 }),
        run("firefox", "A", 0, { "workload.fetch.totalMs" : 50 }),
    ];
    const summary = summarize(runs);

    it("gives the median and the range of the rounds", () => {
        expect(summary.chromium?.A?.metrics["workload.fetch.totalMs"]).toEqual({ median : 150, min : 100, max : 200, n : 3 });
        expect(summary.chromium?.C?.rounds).toBe(3);
    });

    it("compares each round with setup A of the same round", () => {
        // 150 / 100, 220 / 200, 300 / 150
        expect(summary.chromium?.C?.factorsVsA["workload.fetch.totalMs"]).toEqual({ median : 1.5, min : 1.1, max : 2, n : 3 });
        expect(summary.chromium?.C?.differencesVsA["workload.fetch.totalMs"]).toEqual({ median : 50, min : 20, max : 150, n : 3 });
    });

    it("uses only the rounds that have the metric in both setups", () => {
        expect(summary.chromium?.C?.metrics["drift.medianMs"]?.n).toBe(2);
        expect(summary.chromium?.C?.differencesVsA["drift.medianMs"]?.n).toBe(2);
    });

    it("gives the result of a context case, or 'varies' if the rounds differ", () => {
        expect(summary.chromium?.A?.correctness.await).toBe(true);
        expect(summary.chromium?.C?.correctness.await).toBe("varies");
        expect(summary.chromium?.C?.correctness.sync).toBe(true);
    });

    it("gives each engine its own summary", () => {
        expect(summary.firefox?.A?.metrics["workload.fetch.totalMs"]?.median).toBe(50);
        expect(summary.firefox?.C).toBeUndefined();
        expect(summary.webkit).toBeUndefined();
    });

    it("lists the different scripts of the long animation frames", () => {
        expect(summary.chromium?.C?.loafScripts).toEqual(["TimerHandler:setTimeout / C-fn"]);
    });
});

describe("describeScript", () => {
    it("names a script without an invoker or a function name", () => {
        expect(describeScript({ invoker : "", invokerType : "", sourceFunctionName : "", sourceURL : "", duration : 1 })).toBe("(no invoker) / (no function name)");
    });
});
