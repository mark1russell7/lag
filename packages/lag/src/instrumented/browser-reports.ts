import type { CoreDeps, EventDeps, ReportingDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { BrowserReportMonitor, type BrowserReportType } from "../BrowserReportMonitor.js";
import { EVENTS, METRICS, createCounter } from "../metric-catalog.js";
import { RateLimiter, stripUrlParameters } from "../rate-limiter.js";
import { createHandle } from "./shared.js";

const MAX_EVENTS_PER_MINUTE = 10;

/**
 * Constructs a BrowserReportMonitor wired to the `lag_browser_reports`
 * counter, labeled with `type`. With `deps.events`, each report also emits a
 * `lag.browser_report` event with its ID, message and source (at most 10
 * events each minute).
 */
export function createInstrumentedBrowserReports(
    deps : CoreDeps & ReportingDeps & Partial<EventDeps>,
) : MonitorHandle<BrowserReportMonitor> {
    return createHandle("browser-reports", deps.logger, () => {
        const reports = createCounter<{ type : BrowserReportType }>(deps.meter, METRICS.browserReports);
        const limiter = new RateLimiter(deps.clock, MAX_EVENTS_PER_MINUTE, 60_000);

        const monitor = new BrowserReportMonitor(
            (report) => {
                reports.add(1, { type : report.type });
                if (deps.events && limiter.tryAcquire()) {
                    deps.events.emit(EVENTS.browserReport.name, {
                        type : report.type,
                        id : report.id,
                        message : report.message,
                        source_file : stripUrlParameters(report.sourceFile),
                        line_number : report.lineNumber,
                    });
                }
            },
            deps.logger,
            deps.ReportingObserver,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
