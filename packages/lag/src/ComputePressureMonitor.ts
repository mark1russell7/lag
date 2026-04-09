import type { Logger } from "./types.js";

/**
 * Compute Pressure API — Chrome 125+
 * https://developer.chrome.com/docs/web-platform/compute-pressure
 *
 * Reports CPU/system pressure on a 4-state scale:
 * - nominal:  baseline, no perceptible impact
 * - fair:     moderate load, still safe to run discretionary work
 * - serious:  heavy load, defer non-essential work
 * - critical: maximum, system may throttle/skip frames
 */
export type PressureState = "nominal" | "fair" | "serious" | "critical";
export type PressureSource = "cpu" | "thermals" | "power" | "memory";

export type PressureRecord = {
    source : PressureSource;
    state : PressureState;
    time : number;
};

// Duck-typed PressureObserver — no DOM lib dependency
export type PressureObserverInstance = {
    observe(source : PressureSource, options? : { sampleInterval? : number }) : Promise<void>;
    disconnect() : void;
    takeRecords() : PressureRecord[];
};

export type PressureObserverInit = new (
    callback : (records : PressureRecord[], observer : PressureObserverInstance) => void,
    options? : { sampleInterval? : number },
) => PressureObserverInstance;

export type PressureMeasurement = {
    source : PressureSource;
    state : PressureState;
    stateOrdinal : number;  // 0=nominal, 1=fair, 2=serious, 3=critical
    timestamp : number;
};

const STATE_ORDINALS : Record<PressureState, number> = {
    nominal : 0,
    fair : 1,
    serious : 2,
    critical : 3,
};

/**
 * Subscribes to CPU compute pressure changes via the PressureObserver API.
 *
 * Per spec, the observer fires:
 * - On every pressure state change
 * - At most once per sampleInterval (default 1s, max ~30s)
 *
 * Critical state means the OS/browser may already be throttling — this is the
 * "ground truth" for system-level overload, complementing our timer-based lag.
 */
export class ComputePressureMonitor {
    private observer : PressureObserverInstance | undefined;
    private currentStates = new Map<PressureSource, PressureState>();
    private started = false;

    constructor(
        private readonly sources : PressureSource[],
        private readonly report : (measurement : PressureMeasurement) => void,
        private readonly logger : Logger,
        private readonly PressureObserverCtor : PressureObserverInit,
        private readonly sampleIntervalMs : number = 1000,
    ) {
        this.start();
    }

    start() : void {
        if (this.started) return;
        this.started = true;

        try {
            this.observer = new this.PressureObserverCtor(
                (records) => this.handleRecords(records),
                { sampleInterval : this.sampleIntervalMs },
            );

            for (const source of this.sources) {
                this.observer.observe(source, { sampleInterval : this.sampleIntervalMs })
                    .catch((error) => {
                        this.logger.log("warn", `PressureObserver source "${source}" not supported.`, {
                            error,
                            type : "ComputePressureMonitor",
                        });
                    });
            }
        } catch (error) {
            this.logger.log("warn", "PressureObserver not available in this browser.", {
                error,
                type : "ComputePressureMonitor",
            });
        }
    }

    stop() : void {
        this.started = false;
        this.observer?.disconnect();
        this.observer = undefined;
        this.currentStates.clear();
    }

    /** Get the most recently observed state for a source, or undefined if not yet sampled. */
    getCurrentState(source : PressureSource) : PressureState | undefined {
        return this.currentStates.get(source);
    }

    /** Get the maximum (most severe) state across all observed sources. */
    getWorstStateOrdinal() : number {
        let max = -1;
        for (const state of this.currentStates.values()) {
            const ord = STATE_ORDINALS[state];
            if (ord > max) max = ord;
        }
        return max;
    }

    private handleRecords(records : PressureRecord[]) : void {
        for (const record of records) {
            try {
                this.currentStates.set(record.source, record.state);
                this.report({
                    source : record.source,
                    state : record.state,
                    stateOrdinal : STATE_ORDINALS[record.state],
                    timestamp : record.time,
                });
            } catch (error) {
                this.logger.log("error", "Error processing pressure record.", {
                    error,
                    type : "ComputePressureMonitor",
                });
            }
        }
    }
}

export const pressureStateOrdinals : Readonly<Record<PressureState, number>> = STATE_ORDINALS;
