import { SCHEMA_VERSION, summarizeRun, type RunIndex, type RunReport } from "../adapters/lag-report";
import { memoizePromise, memoizePromiseByKey } from "../lib/memoize-promise";
import { ReportDataError, parseRunIndex, parseRunReport } from "./validate";

/** Where the results viewer gets its data. Components use this interface, not `fetch`. */
export interface ReportSource {
    /** The list of runs. A source without data returns an empty list. */
    listRuns() : Promise<RunIndex>;
    /** One run. `file` is the `file` field of a run in the index. */
    getRun(file : string) : Promise<RunReport>;
}

export function emptyRunIndex() : RunIndex {
    return { schemaVersion : SCHEMA_VERSION, runs : [] };
}

/** The folder (below the site base URL) that `pnpm results` writes to. */
export const RESULTS_PATH = "data/results/";

export type FetchResponse = {
    ok : boolean;
    status : number;
    headers : { get(name : string) : string | null };
    json() : Promise<unknown>;
};

export type FetchFunction = (url : string) => Promise<FetchResponse>;

/** A run file name must stay in the results folder. */
export function isSafeRelativePath(file : string) : boolean {
    return file !== ""
        && !file.includes("://")
        && !file.startsWith("/")
        && !file.includes("\\")
        && !file.split("/").some(segment => segment === ".." || segment === ".");
}

export type HttpReportSourceOptions = {
    /** The base URL of the site, as `import.meta.env.BASE_URL` gives it. */
    baseUrl : string;
    fetch? : FetchFunction;
};

/** Reads `data/results/index.json` and the run files from the web server. */
export class HttpReportSource implements ReportSource {
    private readonly root : string;
    private readonly fetchFn : FetchFunction;

    constructor(options : HttpReportSourceOptions) {
        const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
        this.root = `${base}${RESULTS_PATH}`;
        this.fetchFn = options.fetch ?? ((url) => fetch(url));
    }

    async listRuns() : Promise<RunIndex> {
        const response = await this.request("index.json");
        if (!response) return emptyRunIndex();
        return parseRunIndex(await this.readJson(response, "index.json"));
    }

    async getRun(file : string) : Promise<RunReport> {
        const response = await this.request(file);
        if (!response) throw new ReportDataError(`The run file ${file} does not exist.`);
        return parseRunReport(await this.readJson(response, file));
    }

    /** Undefined if the file does not exist: HTTP 404, or the HTML page that a single-page app fallback sends. */
    private async request(file : string) : Promise<FetchResponse | undefined> {
        if (!isSafeRelativePath(file)) throw new ReportDataError(`The run file name "${file}" is not valid.`);
        const response = await this.fetchFn(`${this.root}${file}`);
        if (response.status === 404) return undefined;
        if (!response.ok) throw new ReportDataError(`The server sent HTTP ${response.status} for ${file}.`);
        if ((response.headers.get("content-type") ?? "").includes("text/html")) return undefined;
        return response;
    }

    private async readJson(response : FetchResponse, file : string) : Promise<unknown> {
        try {
            return await response.json();
        } catch {
            throw new ReportDataError(`The file ${file} is not valid JSON.`);
        }
    }
}

/** Results in memory, for tests and for the sample data. */
export class MemoryReportSource implements ReportSource {
    constructor(
        private readonly index : RunIndex,
        private readonly runs : Readonly<Record<string, RunReport>>,
    ) {}

    /** Makes the index from the runs, as the collector does. */
    static fromRuns(runs : ReadonlyArray<{ file : string; report : RunReport }>) : MemoryReportSource {
        const index : RunIndex = {
            schemaVersion : SCHEMA_VERSION,
            runs : runs.map(({ file, report }) => summarizeRun(report, file)),
        };
        return new MemoryReportSource(index, Object.fromEntries(runs.map(({ file, report }) => [file, report])));
    }

    static empty() : MemoryReportSource {
        return new MemoryReportSource(emptyRunIndex(), {});
    }

    listRuns() : Promise<RunIndex> {
        return Promise.resolve(this.index);
    }

    getRun(file : string) : Promise<RunReport> {
        const run = this.runs[file];
        return run ? Promise.resolve(run) : Promise.reject(new ReportDataError(`The run file ${file} does not exist.`));
    }
}

/** Loads each file once. A failed load can try again. */
export function cachedReportSource(inner : ReportSource) : ReportSource {
    const listRuns = memoizePromise(() => inner.listRuns());
    const getRun = memoizePromiseByKey((file) => inner.getRun(file));
    return { listRuns, getRun };
}
