import { LagMonitor } from "./LagMonitor.js";

/** Runs a callback in a new task, for example through `createMessageTaskQueue(...).post`. */
export type PostTaskFn = (callback : () => void) => void;

/**
 * Every `expectedElapsedTimeMs`, measures how long a zero-delay setTimeout
 * waits in the task queue — a proxy for task-queue congestion.
 *
 * With `postTask`, each measurement starts in a message task. Without it,
 * the measurement starts in the `setInterval` callback. Browsers count the
 * repeats of `setInterval` as nested timers and clamp a nested timeout to
 * 4 ms or more, thus expect a floor of approximately 4 ms without `postTask`.
 */
export class MacrotaskLag extends LagMonitor {
    private handle : number | undefined;
    private readonly postTask : PostTaskFn | undefined;

    constructor(...args : [...ConstructorParameters<typeof LagMonitor>, postTask? : PostTaskFn]) {
        const [expectedElapsedTimeMs, report, logger, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, clock, postTask] = args;
        super(expectedElapsedTimeMs, report, logger, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, clock);
        this.postTask = postTask;
        this.start();
    }

    public start() : void {
        if (this.handle !== undefined) return;
        this.handle = this.setIntervalFn(() => {
            void this.measureAndReport();
        }, this.expectedElapsedTimeMs);
    }

    public stop() : void {
        if (this.handle === undefined) return;
        this.clearIntervalFn(this.handle);
        this.handle = undefined;
    }

    measure() : Promise<number> {
        return new Promise(resolve => {
            const run = () : void => {
                const start = this.clock.now();
                this.setTimeoutFn(() => {
                    resolve(this.clock.now() - start);
                }, 0);
            };
            if (this.postTask) this.postTask(run);
            else run();
        });
    }

    private async measureAndReport() : Promise<void> {
        try {
            const lag = await this.measure();
            // Skip the in-flight sample if stop() was called while it waited
            if (this.handle !== undefined) {
                this.report(lag);
            }
        } catch (error) {
            this.logger.log("error", "Error measuring/reporting lag.", {
                error,
                type : "LagMonitor",
                subtype : "MacrotaskLag",
            });
        }
    }
}
