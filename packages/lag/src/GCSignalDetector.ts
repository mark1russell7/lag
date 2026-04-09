import type { Clock, Logger, SetIntervalFn, ClearIntervalFn } from "./types.js";

/**
 * Duck-typed FinalizationRegistry — no DOM lib dependency required.
 *
 * This API is part of the JavaScript spec (ES2021) and is supported in all
 * modern engines: V8 (Chrome/Node), JSC (Safari), SpiderMonkey (Firefox).
 *
 * Notes from the spec:
 * - Cleanup callbacks fire AFTER an object is collected, in a separate
 *   microtask cycle.
 * - The engine MAY batch callbacks or delay them.
 * - The engine MAY decide not to fire callbacks at all in some cases (e.g.,
 *   abrupt page termination).
 * - Callbacks must NEVER fire synchronously during JS execution.
 *
 * For our purposes — correlating lag spikes with GC events — these guarantees
 * are sufficient. A real GC happened iff at least one callback eventually fires.
 */
export type FinalizationRegistryInstance<T> = {
    register(target : object, heldValue : T, unregisterToken? : object) : void;
    unregister(unregisterToken : object) : void;
};

export type FinalizationRegistryConstructor = new <T>(
    cleanup : (heldValue : T) => void,
) => FinalizationRegistryInstance<T>;

const DEFAULT_ALLOC_INTERVAL_MS = 250;
const DEFAULT_HISTORY_SIZE = 200;

/**
 * Detects real garbage collection events via FinalizationRegistry.
 *
 * How it works:
 *   1. On a fixed interval, allocates a sacrificial "canary" object and
 *      registers it with a FinalizationRegistry, holding only a weak reference
 *      via the registry's heldValue.
 *   2. The canary object goes out of scope immediately after registration.
 *   3. Whenever the JS engine actually GCs the canary, the registry's cleanup
 *      callback fires, and we record a timestamp.
 *
 * This is **not** a heuristic — every recorded event corresponds to an actual
 * GC cycle the engine performed (modulo browser delays in firing finalization
 * callbacks).
 *
 * Use cases:
 *   - Tag lag measurements with `gcRecentlyOccurred` for forensic analysis.
 *   - Track GC frequency (events/sec) over time to detect allocation pressure.
 *   - Correlate p99 lag spikes with GC timing.
 */
export class GCSignalDetector {
    private registry : FinalizationRegistryInstance<number>;
    private gcTimestamps : number[] = []; // ring buffer of recent collect times
    private allocHandle : number | undefined;
    private totalGCEvents = 0;
    private started = false;

    constructor(
        FinalizationRegistryCtor : FinalizationRegistryConstructor,
        private readonly clock : Clock,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        private readonly logger : Logger,
        private readonly allocIntervalMs : number = DEFAULT_ALLOC_INTERVAL_MS,
        private readonly historySize : number = DEFAULT_HISTORY_SIZE,
    ) {
        this.registry = new FinalizationRegistryCtor<number>((_heldValue : number) => {
            try {
                const collectTime = this.clock.now();
                this.gcTimestamps.push(collectTime);
                this.totalGCEvents++;
                if (this.gcTimestamps.length > this.historySize) {
                    this.gcTimestamps.shift();
                }
                // _heldValue is the alloc timestamp. We currently discard it,
                // but future versions could expose alloc-to-collect latency.
            } catch (error) {
                this.logger.log("error", "Error in GC finalization callback.", {
                    error,
                    type : "GCSignalDetector",
                });
            }
        });
        this.start();
    }

    start() : void {
        if (this.started) return;
        this.started = true;
        // Allocate immediately, then on a schedule
        this.allocateCanary();
        this.allocHandle = this.setIntervalFn(() => this.allocateCanary(), this.allocIntervalMs);
    }

    stop() : void {
        this.started = false;
        if (this.allocHandle !== undefined) {
            this.clearIntervalFn(this.allocHandle);
            this.allocHandle = undefined;
        }
    }

    /**
     * Returns true if at least one GC event has been observed within the
     * last `withinMs` milliseconds. Use this to tag lag measurements with
     * "GC recently happened" forensic information.
     */
    didGCRecently(withinMs : number) : boolean {
        const now = this.clock.now();
        // Walk backward — recent events are at the end
        for (let i = this.gcTimestamps.length - 1; i >= 0; i--) {
            if (now - this.gcTimestamps[i]! <= withinMs) return true;
        }
        return false;
    }

    /**
     * Returns the number of GC events observed within the given time window
     * (looking backward from now).
     */
    getRecentGCEvents(windowMs : number) : number {
        const now = this.clock.now();
        let count = 0;
        for (let i = this.gcTimestamps.length - 1; i >= 0; i--) {
            if (now - this.gcTimestamps[i]! <= windowMs) count++;
            else break; // older — no more in window
        }
        return count;
    }

    /** Total number of GC events observed since startup. */
    getTotalGCEvents() : number {
        return this.totalGCEvents;
    }

    /** Returns timestamps for testing/inspection. */
    getEventTimestamps() : readonly number[] {
        return this.gcTimestamps;
    }

    /**
     * Force an immediate canary allocation. Useful for tests; in production,
     * the periodic timer handles this automatically.
     */
    allocateCanary() : void {
        if (!this.started && this.allocHandle !== undefined) return;
        const allocTime = this.clock.now();
        // The canary can be any object — we use a small one to keep overhead low.
        // After this function returns, `canary` is unreachable and the engine
        // is free to collect it whenever it next runs GC.
        const canary = {};
        this.registry.register(canary, allocTime);
    }
}
