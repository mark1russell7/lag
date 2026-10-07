import { driftStepMs } from "./constants.js";
import { LagMonitor } from "./LagMonitor.js";

/**
 * Measures event-loop lag by chaining `driftStepMs` timeouts until the
 * expected interval has elapsed, then reporting `actual elapsed − scheduled`.
 *
 * Blocking anywhere in the window delays the chain, so the reported value
 * accumulates all lag in the window — unlike a single long setTimeout, which
 * only notices blocking that overlaps its deadline.
 */
export class DriftLag extends LagMonitor {
    private handle : number | undefined;
    private windowStart = 0;
    /** The interval rounded down to whole steps (minimum one step). */
    private readonly scheduledMs : number = Math.max(
        driftStepMs,
        Math.floor(this.expectedElapsedTimeMs / driftStepMs) * driftStepMs,
    );

    constructor(...args : ConstructorParameters<typeof LagMonitor>) {
        super(...args);
        this.start();
    }

    public start() : void {
        if (this.handle !== undefined) return;
        this.windowStart = this.clock.now();
        this.step(this.scheduledMs / driftStepMs);
    }

    public stop() : void {
        if (this.handle === undefined) return;
        this.clearTimeoutFn(this.handle);
        this.handle = undefined;
    }

    measure() : number {
        const now = this.clock.now();
        const lag = now - this.windowStart - this.scheduledMs;
        this.windowStart = now;
        return lag;
    }

    private step(remaining : number) : void {
        const handle : number = this.setTimeoutFn(() => {
            if (remaining > 1) {
                this.step(remaining - 1);
                return;
            }
            try {
                this.report(this.measure());
            } catch (error) {
                this.logger.log("error", "Error measuring/reporting lag.", {
                    error,
                    type : "LagMonitor",
                    subtype : "DriftLag",
                });
            }
            // Continue only if report() didn't stop (or stop and restart) the monitor
            if (this.handle === handle) {
                this.step(this.scheduledMs / driftStepMs);
            }
        }, driftStepMs);
        this.handle = handle;
    }
}
