/**
 * A Vitest browser command that sends a PromQL query to Mimir from Node.
 * Mimir sends no CORS headers, thus a test page cannot read the answer of a
 * query itself.
 */
import type { BrowserCommand } from "vitest/node";

const MIMIR_QUERY_URL = "http://localhost:9009/prometheus/api/v1/query";

/** This command gives the first value of the answer, or 0 when Mimir has no value or does not answer. */
export const queryMimirValue : BrowserCommand<[query : string], number> = async (_ctx, query) => {
    try {
        const response = await fetch(`${MIMIR_QUERY_URL}?query=${encodeURIComponent(query)}`);
        const json = await response.json() as { data? : { result? : Array<{ value : [number, string] }> } };
        return Number(json.data?.result?.[0]?.value[1] ?? 0);
    } catch {
        // Mimir is not reachable: expected without the Grafana stack
        return 0;
    }
};

export const mimirCommands = { queryMimirValue };
