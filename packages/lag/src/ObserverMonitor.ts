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
                (list : PerformanceEntryList) => this.processEntries(list.getEntries()),
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

    /**
     * Processes the entries that the browser has not delivered yet. Use it
     * before a checkpoint, for example when the page becomes hidden: the
     * browser delivers entries asynchronously, and possibly not again before
     * the page unloads.
     */
    takeRecords() : void {
        const records = this.takePendingEntries();
        if (records.length > 0) this.processEntries(records);
    }

    /** Removes the entries that the browser has not delivered yet, and gives them without processing. */
    protected takePendingEntries() : PerformanceEntryLike[] {
        return this.observer?.takeRecords?.() ?? [];
    }

    /** Processes each entry. An error in one entry does not stop the others. */
    protected processEntries(entries : readonly PerformanceEntryLike[]) : void {
        for (const entry of entries) {
            try {
                this.processEntry(entry);
            } catch (error) {
                this.logger.log("error", "Error processing performance entry.", {
                    error,
                    entryType : this.entryType,
                });
            }
        }
    }

    protected abstract processEntry(entry : PerformanceEntryLike) : void;
}
