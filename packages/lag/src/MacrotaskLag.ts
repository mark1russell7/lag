import { LagMonitor } from "./LagMonitor.js";
import type { PostTaskFn } from "./message-task.js";

/**
 * This monitor measures how long a zero-delay `setTimeout` waits in the task
 * queue, one time in each `expectedElapsedTimeMs`. The value is an indirect
 * measure of the congestion of the task queue.
 *
 * With `postTask`, each measurement starts in a message task. Without it,
 * the measurement starts in the `setInterval` callback. Browsers count the
 * repeats of `setInterval` as nested timers, and they clamp a nested timeout
 * to 4 ms or more. Thus, without `postTask`, the values have a minimum of
 * approximately 4 ms.
 */
export class MacrotaskLag extends LagMonitor {
    private handle : number | undefined;
    /**
     * `start()` increments this value. A measurement that started before a
     * stop and a new start must not report.
     */
    private generation = 0;
    private readonly postTask : PostTaskFn | undefined;

    constructor(...args : [...ConstructorParameters<typeof LagMonitor>, postTask? : PostTaskFn]) {
        const [expectedElapsedTimeMs, report, logger, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, clock, postTask] = args;
        super(expectedElapsedTimeMs, report, logger, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, clock);
        this.postTask = postTask;
        this.start();
    }

    public start() : void {
        if (this.handle !== undefined) return;
        this.generation++;
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
        const generation = this.generation;
        try {
            const lag = await this.measure();
            // Skip the in-flight sample if stop() was called while it waited, also after a new start()
            if (this.handle !== undefined && generation === this.generation) {
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
