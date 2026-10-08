import { useOutletContext } from "react-router";
import type { RunIndex, RunReport, RunSummary } from "../../adapters/lag-report";

/** What `RunLayout` gives to the views of one run. */
export type RunContext = {
    index : RunIndex;
    summary : RunSummary;
    run : RunReport;
};

export function useRunContext() : RunContext {
    return useOutletContext<RunContext>();
}
