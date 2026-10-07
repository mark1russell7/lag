import type { Logger } from "./types.js";

/** A duck-typed report of the Reporting API (an item of the `ReportingObserver` callback). */
export type ReportLike = {
    type : string;
    url : string;
    body : unknown;
};

export type ReportingObserverInstance = {
    observe() : void;
    disconnect() : void;
};

export type ReportingObserverInit = new (
    callback : (reports : ReportLike[], observer : ReportingObserverInstance) => void,
    options? : { types? : string[]; buffered? : boolean },
) => ReportingObserverInstance;

export type BrowserReportType = "intervention" | "deprecation";

export type BrowserReport = {
    type : BrowserReportType;
    id : string;
    message : string;
    sourceFile : string;
    lineNumber : number;
};

const DEFAULT_TYPES : readonly BrowserReportType[] = ["intervention", "deprecation"];

function readBody(body : unknown) : Omit<BrowserReport, "type"> {
    const b = (body ?? {}) as { id? : unknown; message? : unknown; sourceFile? : unknown; lineNumber? : unknown };
    return {
        id : typeof b.id === "string" ? b.id : "",
        message : typeof b.message === "string" ? b.message : "",
        sourceFile : typeof b.sourceFile === "string" ? b.sourceFile : "",
        lineNumber : typeof b.lineNumber === "number" ? b.lineNumber : 0,
    };
}

/**
 * This monitor observes the reports of the Reporting API that the page
 * itself can read: interventions and deprecations. In an intervention, the
 * browser blocked or changed an action, for example a slow script or a
 * heavy ad.
 *
 * Crash reports (for example "oom" or "unresponsive") go only to the server
 * endpoints in the `Reporting-Endpoints` header, because the page is gone.
 */
export class BrowserReportMonitor {
    private observer : ReportingObserverInstance | undefined;

    constructor(
        private readonly report : (report : BrowserReport) => void,
        private readonly logger : Logger,
        private readonly ReportingObserverCtor : ReportingObserverInit,
        private readonly types : readonly BrowserReportType[] = DEFAULT_TYPES,
    ) {
        this.start();
    }

    start() : void {
        if (this.observer) return;
        try {
            const observer = new this.ReportingObserverCtor((reports) => {
                for (const r of reports) {
                    if (!this.types.includes(r.type as BrowserReportType)) continue;
                    try {
                        this.report({ type : r.type as BrowserReportType, ...readBody(r.body) });
                    } catch (error) {
                        this.logger.log("error", "Error processing browser report.", { error, type : "BrowserReportMonitor" });
                    }
                }
            }, { types : [...this.types], buffered : true });
            observer.observe();
            this.observer = observer;
        } catch (error) {
            this.logger.log("warn", "ReportingObserver not available in this browser.", { error, type : "BrowserReportMonitor" });
        }
    }

    stop() : void {
        this.observer?.disconnect();
        this.observer = undefined;
    }
}
