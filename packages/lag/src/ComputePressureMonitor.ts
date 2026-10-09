import type { Logger } from "./types.js";

/**
 * The Compute Pressure API, in Chrome 125 and later. Refer to
 * https://developer.chrome.com/docs/web-platform/compute-pressure.
 *
 * The API reports the pressure on the CPU or on the system, on a scale of 4
 * states:
 * - `nominal`: the baseline, with no perceptible effect.
 * - `fair`: a moderate load. It is safe to do optional work.
 * - `serious`: a heavy load. Postpone the work that is not necessary.
 * - `critical`: the maximum. The system can throttle or skip frames.
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

/** The constructor takes only the callback. `sampleInterval` is an option of `observe()`, as in the current specification. */
export type PressureObserverInit = new (
    callback : (records : PressureRecord[], observer : PressureObserverInstance) => void,
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
 * This monitor subscribes to the changes of the compute pressure through
 * the `PressureObserver` API.
 *
 * As the specification tells, the observer fires:
 * - at each change of the pressure state
 * - no more than one time in each `sampleInterval`. The default of this
 *   monitor is 1 s.
 *
 * The `critical` state means that the operating system or the browser can
 * throttle already. This state is the "ground truth" for an overload of the
 * system. It adds information to the timer-based lag of this package.
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
            const observer = new this.PressureObserverCtor((records) => this.handleRecords(records));
            this.observer = observer;

            for (const source of this.sources) {
                observer.observe(source, { sampleInterval : this.sampleIntervalMs })
                    .catch((error) => {
                        // disconnect() at stop() rejects each pending observe() with an AbortError
                        if (this.observer !== observer) return;
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

    /** The most recently observed state of a source, or `undefined` if the source has no record yet. */
    getCurrentState(source : PressureSource) : PressureState | undefined {
        return this.currentStates.get(source);
    }

    /**
     * The ordinal of the maximum (most severe) state of all observed sources,
     * or -1 if no source has a state.
     */
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
