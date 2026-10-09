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
     * The constructor starts the observation immediately. In this base class,
     * that is safe, but in `LagMonitor` it is not. `start()` changes only the
     * fields of this class.
     *
     * Usually, `PerformanceObserver` delivers entries asynchronously. Old
     * Safari gave the buffered entries to the callback inside `observe()`
     * (WebKit bug 247863), before the subclass set its fields. Thus `start()`
     * moves such a delivery to a microtask, as web-vitals does. No entry comes
     * before the construction of the subclass is complete.
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
            let observing = true;
            const observer = new this.PerformanceObserverCtor((list : PerformanceEntryList) => {
                const entries = list.getEntries();
                if (!observing) {
                    this.receive(entries);
                    return;
                }
                // A delivery inside observe(): give it to the subclass after the construction.
                // A stop() before the microtask discards it, because a restart gets the buffer again.
                void Promise.resolve().then(() => {
                    if (this.observer === observer) this.receive(entries);
                });
            });
            observer.observe({ ...this.observeOptions, type : this.entryType, buffered : true });
            observing = false;
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
     * This method processes the entries that the browser did not deliver
     * yet. Use it before a checkpoint, for example when the page becomes
     * hidden. The browser delivers entries asynchronously, and possibly not
     * again before the page unloads.
     */
    takeRecords() : void {
        const records = this.takePendingEntries();
        if (records.length > 0) this.processEntries(records);
    }

    /**
     * This method removes the entries that the browser did not deliver yet.
     * It gives them, but it does not process them.
     */
    protected takePendingEntries() : PerformanceEntryLike[] {
        return this.observer?.takeRecords?.() ?? [];
    }

    /** The browser gives each delivery of entries to this method. By default, the method processes the entries. */
    protected receive(entries : readonly PerformanceEntryLike[]) : void {
        this.processEntries(entries);
    }

    /** This method processes each entry. An error in one entry does not stop the other entries. */
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
