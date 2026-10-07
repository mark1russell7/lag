import type { Logger } from "./types.js";
import type {
    PerformanceEntryLike,
    PerformanceEntryList,
    PerformanceObserverInit,
    PerformanceObserverInstance,
    PerformanceObserverOptions,
} from "./perf-types.js";

export abstract class ObserverMonitor {
    private observer : PerformanceObserverInstance | undefined;

    /**
     * Starts observing immediately. Unlike LagMonitor this is safe from a base
     * constructor: start() only touches this class's own fields, and
     * PerformanceObserver delivers entries asynchronously, never before the
     * subclass has finished constructing.
     */
    constructor(
        protected readonly entryType : string,
        protected readonly logger : Logger,
        private readonly PerformanceObserverCtor : PerformanceObserverInit,
        private readonly observeOptions : PerformanceObserverOptions = {},
    ) {
        this.start();
    }

    start() : void {
        if (this.observer) {
            return;
        }
        const supported = this.PerformanceObserverCtor.supportedEntryTypes;
        if (supported && !supported.includes(this.entryType)) {
            this.logger.log("warn", `PerformanceObserver type "${this.entryType}" not supported.`, {
                entryType : this.entryType,
            });
            return;
        }
        try {
            const observer = new this.PerformanceObserverCtor(
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
            observer.observe({ ...this.observeOptions, type : this.entryType, buffered : true });
            this.observer = observer;
        } catch (error) {
            this.logger.log("warn", `PerformanceObserver type "${this.entryType}" not supported.`, {
                error,
                entryType : this.entryType,
            });
        }
    }

    stop() : void {
        this.observer?.disconnect();
        this.observer = undefined;
    }

    protected abstract processEntry(entry : PerformanceEntryLike) : void;
}
