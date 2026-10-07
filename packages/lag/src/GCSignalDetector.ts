import type { Clock, Logger } from "./types.js";

/**
 * Duck-typed FinalizationRegistry — no DOM lib dependency required.
 *
 * This API is part of the JavaScript spec (ES2021) and is supported in all
 * modern engines: V8 (Chrome/Node), JSC (Safari), SpiderMonkey (Firefox).
 *
 * Notes from the spec:
 * - Cleanup callbacks fire AFTER an object is collected, as a separate task.
 * - The engine MAY batch callbacks or delay them.
 * - The engine MAY decide not to fire callbacks at all in some cases (e.g.,
 *   abrupt page termination).
 * - Callbacks must NEVER fire synchronously during JS execution.
 */
export type FinalizationRegistryInstance<T> = {
    register(target : object, heldValue : T, unregisterToken? : object) : void;
    unregister(unregisterToken : object) : void;
};

export type FinalizationRegistryConstructor = new <T>(
    cleanup : (heldValue : T) => void,
) => FinalizationRegistryInstance<T>;

const DEFAULT_HISTORY_SIZE = 200;

/**
 * Detects garbage collection cycles via FinalizationRegistry.
 *
 * Exactly one sacrificial "canary" object is in flight at a time: it is
 * registered with a FinalizationRegistry and immediately dropped. When the
 * engine collects it, the cleanup callback records a GC event and arms the
 * next canary. One canary per GC means one event per GC — allocating canaries
 * on a timer instead would count every canary a single GC swept up.
 *
 * Only GCs that collect the canary are seen: engines may leave young objects
 * to a later cycle, so this undercounts minor GCs rather than overcounting.
 *
 * Use cases:
 *   - Tag lag measurements with "GC recently happened" for forensic analysis.
 *   - Track GC frequency over time to detect allocation pressure.
 *   - Correlate p99 lag spikes with GC timing.
 */
export class GCSignalDetector {
    private readonly registry : FinalizationRegistryInstance<undefined>;
    private readonly gcTimestamps : number[] = []; // recent collect times, oldest first
    private totalGCEvents = 0;
    private started = false;
    private canaryInFlight = false;

    constructor(
        FinalizationRegistryCtor : FinalizationRegistryConstructor,
        private readonly clock : Clock,
        private readonly logger : Logger,
        private readonly onGC : (timestamp : number) => void = () => {},
        private readonly historySize : number = DEFAULT_HISTORY_SIZE,
    ) {
        this.registry = new FinalizationRegistryCtor<undefined>(() => this.onCanaryCollected());
        this.start();
    }

    start() : void {
        if (this.started) return;
        this.started = true;
        // After a stop/start, the previous canary may still be in flight
        if (!this.canaryInFlight) this.armCanary();
    }

    stop() : void {
        this.started = false;
    }

    /**
     * Returns true if at least one GC event has been observed within the
     * last `withinMs` milliseconds.
     */
    didGCRecently(withinMs : number) : boolean {
        const last = this.gcTimestamps[this.gcTimestamps.length - 1];
        return last !== undefined && this.clock.now() - last <= withinMs;
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

    private armCanary() : void {
        this.canaryInFlight = true;
        // Unreachable as soon as this returns; the engine may collect it on its next GC
        this.registry.register({}, undefined);
    }

    private onCanaryCollected() : void {
        this.canaryInFlight = false;
        if (!this.started) return;

        try {
            const collectTime = this.clock.now();
            this.gcTimestamps.push(collectTime);
            this.totalGCEvents++;
            if (this.gcTimestamps.length > this.historySize) {
                this.gcTimestamps.shift();
            }
            this.onGC(collectTime);
        } catch (error) {
            this.logger.log("error", "Error in GC finalization callback.", {
                error,
                type : "GCSignalDetector",
            });
        }
        this.armCanary();
    }
}
