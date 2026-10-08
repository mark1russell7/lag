import type { Clock, Logger } from "./types.js";

/**
 * A duck-typed `FinalizationRegistry`, without a dependency on the DOM
 * library.
 *
 * This API is part of the JavaScript specification (ES2021). All modern
 * engines support it: V8 (Chrome and Node.js), JSC (Safari) and
 * SpiderMonkey (Firefox).
 *
 * The specification gives these rules:
 * - Cleanup callbacks fire *after* the engine collects an object, as a
 *   separate task.
 * - The engine can put callbacks in a batch, or delay them.
 * - In some cases, the engine can decide not to fire the callbacks, for
 *   example when the page stops abruptly.
 * - The engine must not fire callbacks synchronously during the execution
 *   of JavaScript.
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
 * This class finds garbage collection cycles through `FinalizationRegistry`.
 *
 * At one time, only one "canary" object is in flight. The detector
 * registers it with a `FinalizationRegistry` and drops it immediately. When
 * the engine collects it, the cleanup callback records a GC event and arms
 * the next canary. Thus, one canary for each GC gives one event for each GC.
 * A timer that makes canaries is not correct, because then one GC that
 * collects many canaries counts as many events.
 *
 * The detector sees only the GCs that collect the canary. Engines can leave
 * young objects to a later cycle. Thus, the detector counts too few minor
 * GCs, but not too many.
 *
 * Use cases:
 *   - Add "a GC occurred recently" to lag measurements, for a later analysis.
 *   - Follow the GC frequency over time, to find allocation pressure.
 *   - Correlate the p99 lag spikes with the times of the GCs.
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
     * True if the detector observed at least one GC event in the last
     * `withinMs` milliseconds.
     */
    didGCRecently(withinMs : number) : boolean {
        const last = this.gcTimestamps[this.gcTimestamps.length - 1];
        return last !== undefined && this.clock.now() - last <= withinMs;
    }

    /**
     * The number of GC events that the detector observed in the last
     * `windowMs` milliseconds, back from the current time.
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

    /** The total number of GC events that the detector observed since its construction. */
    getTotalGCEvents() : number {
        return this.totalGCEvents;
    }

    /** The timestamps of the recent GC events, oldest first, for tests and inspection. */
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
