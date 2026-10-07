import { LagMonitor } from "./LagMonitor.js";

/**
 * Every `expectedElapsedTimeMs`, measures how long a zero-delay setTimeout
 * waits in the task queue — a proxy for task-queue congestion.
 *
 * Browsers count setInterval repeats as nested timers, and clamp nested
 * timeouts to ≥4ms: after the first few samples, expect a ~4ms floor.
 */
export class MacrotaskLag extends LagMonitor {
    private handle : number | undefined;

    constructor(...args : ConstructorParameters<typeof LagMonitor>) {
        super(...args);
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
            const start = this.clock.now();
            this.setTimeoutFn(() => {
                resolve(this.clock.now() - start);
            }, 0);
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
