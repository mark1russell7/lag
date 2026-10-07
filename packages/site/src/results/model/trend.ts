import type { RunIndex, RunSummary, TestStatus } from "../../adapters/lag-report";
import { STATUS_ORDER } from "./tests";

export function sortRunsNewestFirst(runs : readonly RunSummary[]) : RunSummary[] {
    return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export type TrendRow = {
    runId : string;
    createdAt : string;
    status : TestStatus;
    count : number;
};

/** One row for each run and status, the oldest run first, for the chart of counts over time. */
export function runTrend(index : RunIndex) : TrendRow[] {
    return sortRunsNewestFirst(index.runs)
        .reverse()
        .flatMap(run => STATUS_ORDER.map(status => ({
            runId : run.id,
            createdAt : run.createdAt,
            status,
            count : run.counts[status],
        })));
}
