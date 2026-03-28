import type { Logger } from "./types.js";
import type {
    PerformanceEntryLike,
    PerformanceEntryList,
    PerformanceObserverInit,
    PerformanceObserverInstance,
} from "./perf-types.js";

export abstract class ObserverMonitor {
    protected observer : PerformanceObserverInstance | undefined;

    constructor(
        protected readonly entryType : string,
        protected readonly logger : Logger,
        protected readonly PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        this.start();
    }

    start() : void {
        if (this.observer) {
            return;
        }
        try {
            this.observer = new this.PerformanceObserverCtor(
                (list : PerformanceEntryList) => {
                    for (const entry of list.getEntries()) {
                        try {
                            this.processEntry(entry);
                        } catch (error) {
                            this.logger.log("error", "Error processing performance entry.", {
                                error,
                                entryType : this.entryType,
                            });
                        }
                    }
                },
            );
            this.observer.observe({ type : this.entryType, buffered : true });
        } catch (error) {
            this.logger.log("warn", `PerformanceObserver type "${this.entryType}" not supported.`, {
                error,
            });
        }
    }

    stop() : void {
        this.observer?.disconnect();
        this.observer = undefined as PerformanceObserverInstance | undefined;
    }

    protected abstract processEntry(entry : PerformanceEntryLike) : void;
}
