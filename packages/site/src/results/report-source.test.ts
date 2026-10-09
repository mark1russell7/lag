import { describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "../adapters/lag-report";
import { createSampleReportSource, SAMPLE_RUNS } from "../fixtures/sample-results";
import {
    cachedReportSource,
    HttpReportSource,
    isSafeRelativePath,
    MemoryReportSource,
    type FetchFunction,
    type FetchResponse,
} from "./report-source";
import { ReportDataError } from "./validate";

function response(status : number, body : unknown, contentType = "application/json") : FetchResponse {
    return {
        ok : status >= 200 && status < 300,
        status,
        headers : { get : (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
        json : () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
    };
}

function fakeFetch(files : Readonly<Record<string, FetchResponse>>) : FetchFunction & { calls : string[] } {
    const calls : string[] = [];
    const fn = (url : string) : Promise<FetchResponse> => {
        calls.push(url);
        return Promise.resolve(files[url] ?? response(404, null, "text/plain"));
    };
    return Object.assign(fn, { calls });
}

const index = { schemaVersion : SCHEMA_VERSION, runs : [] };

describe("HttpReportSource", () => {
    it("reads index.json below the base URL", async () => {
        const fetch = fakeFetch({ "/lag/data/results/index.json" : response(200, index) });
        const source = new HttpReportSource({ baseUrl : "/lag/", fetch });
        await expect(source.listRuns()).resolves.toEqual(index);
        expect(fetch.calls).toEqual(["/lag/data/results/index.json"]);
    });

    it("adds the slash after a base URL without one", async () => {
        const fetch = fakeFetch({ "/lag/data/results/index.json" : response(200, index) });
        await new HttpReportSource({ baseUrl : "/lag", fetch }).listRuns();
        expect(fetch.calls).toEqual(["/lag/data/results/index.json"]);
    });

    it("gives an empty index if there is no file", async () => {
        const source = new HttpReportSource({ baseUrl : "/", fetch : fakeFetch({}) });
        await expect(source.listRuns()).resolves.toEqual({ schemaVersion : SCHEMA_VERSION, runs : [] });
    });

    it("gives an empty index for the HTML page of a single-page app fallback", async () => {
        const fetch = fakeFetch({ "/data/results/index.json" : response(200, null, "text/html; charset=utf-8") });
        await expect(new HttpReportSource({ baseUrl : "/", fetch }).listRuns()).resolves.toEqual(index);
    });

    it("fails for a server error and for bad JSON", async () => {
        const failing = new HttpReportSource({ baseUrl : "/", fetch : fakeFetch({ "/data/results/index.json" : response(500, null) }) });
        await expect(failing.listRuns()).rejects.toThrow("HTTP 500");
        const badJson = new HttpReportSource({ baseUrl : "/", fetch : fakeFetch({ "/data/results/index.json" : response(200, new SyntaxError("x")) }) });
        await expect(badJson.listRuns()).rejects.toThrow("is not valid JSON");
    });

    it("accepts a run without budget counts, and refuses budget counts that are not numbers", async () => {
        const run = { id : "r", file : "runs/r.json", createdAt : "2026-10-08T00:00:00.000Z", counts : { passed : 1, failed : 0, skipped : 0, todo : 0 } };
        const read = (runs : unknown[]) => new HttpReportSource({
            baseUrl : "/",
            fetch : fakeFetch({ "/data/results/index.json" : response(200, { schemaVersion : SCHEMA_VERSION, runs }) }),
        }).listRuns();
        await expect(read([run, { ...run, id : "s", budgets : { pass : 1, fail : 1 } }])).resolves.toMatchObject({ runs : [{ id : "r" }, { id : "s" }] });
        await expect(read([{ ...run, budgets : { pass : "1", fail : 0 } }])).rejects.toBeInstanceOf(ReportDataError);
    });

    it("fails for an old schema version", async () => {
        const fetch = fakeFetch({ "/data/results/index.json" : response(200, { schemaVersion : 0, runs : [] }) });
        await expect(new HttpReportSource({ baseUrl : "/", fetch }).listRuns()).rejects.toBeInstanceOf(ReportDataError);
    });

    it("reads a run file and checks it", async () => {
        const run = SAMPLE_RUNS[1]!.report;
        const fetch = fakeFetch({ "/data/results/runs/b.json" : response(200, run) });
        const source = new HttpReportSource({ baseUrl : "/", fetch });
        await expect(source.getRun("runs/b.json")).resolves.toBe(run);
        await expect(source.getRun("runs/missing.json")).rejects.toThrow("does not exist");
    });

    it("refuses a run file outside the results folder", async () => {
        const source = new HttpReportSource({ baseUrl : "/", fetch : fakeFetch({}) });
        await expect(source.getRun("../secret.json")).rejects.toThrow("is not valid");
        await expect(source.getRun("https://example.org/x.json")).rejects.toThrow("is not valid");
    });
});

describe("isSafeRelativePath", () => {
    it("accepts a path in the folder and rejects other paths", () => {
        expect(isSafeRelativePath("runs/2026-10-06.json")).toBe(true);
        expect(isSafeRelativePath("index.json")).toBe(true);
        for (const bad of ["", "/abs.json", "../up.json", "a/../b.json", "a\\b.json", "http://x/y.json", "./a.json"]) {
            expect(isSafeRelativePath(bad), bad).toBe(false);
        }
    });
});

describe("MemoryReportSource", () => {
    it("makes the index from the runs", async () => {
        const source = createSampleReportSource();
        const runIndex = await source.listRuns();
        expect(runIndex.runs.map(run => run.file)).toEqual(SAMPLE_RUNS.map(run => run.file));
        expect(runIndex.runs[1]?.counts.failed).toBe(3);
        expect(runIndex.runs[1]?.budgets?.fail).toBeGreaterThan(0);
        await expect(source.getRun(SAMPLE_RUNS[0]!.file)).resolves.toBe(SAMPLE_RUNS[0]!.report);
        await expect(source.getRun("nope.json")).rejects.toBeInstanceOf(ReportDataError);
    });

    it("can be empty", async () => {
        await expect(MemoryReportSource.empty().listRuns()).resolves.toEqual(index);
    });
});

describe("cachedReportSource", () => {
    it("loads each file once and tries again after a failure", async () => {
        const inner = {
            listRuns : vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(index),
            getRun : vi.fn().mockResolvedValue(SAMPLE_RUNS[0]!.report),
        };
        const source = cachedReportSource(inner);
        await expect(source.listRuns()).rejects.toThrow("offline");
        await expect(source.listRuns()).resolves.toBe(index);
        await source.listRuns();
        expect(inner.listRuns).toHaveBeenCalledTimes(2);
        await source.getRun("a");
        await source.getRun("a");
        await source.getRun("b");
        expect(inner.getRun).toHaveBeenCalledTimes(2);
    });
});
