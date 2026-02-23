import { driftStepMs } from "./constants.js";
import { LagMonitor } from "./LagMonitor.js";
import type { ClearTimeoutFn, Clock, Logger, SetTimeoutFn } from "./types.js";

export class DriftLag  extends LagMonitor {
    private lastLoopEndTime : number = this.clock.now();
    private handle?: number;
    private started : boolean = false;
    public start() : void {
        if (this.started) {
            return;
        }
        this.started = true;
        const roundedMax = Math.floor( this.expectedElapsedTimeMs / driftStepMs) * driftStepMs;
        this.drift(0, driftStepMs, roundedMax);
    }

    private drift(i : number = 0, step : number, max : number) : void {
        this.handle = this.setTimeoutFn(() => {
            if(i + 1 < max / step) {
                this.drift(i + 1, step, max);
            }else {
                try {
                    this.report(this.measure());
                }catch(error){
                    this.logger.log(
                        'error', 'Error measuring/reporting lag.', 
                    {
                        error,
                        type : 'LagMonitor',
                        subtype : 'DriftLag',
                    });
                }finally{
                    this.drift(0, step, max);
                }
            }
        }, step);
    }

    measure() : number {
        const loopStartTime = this.lastLoopEndTime;
        const loopEndTime = this.clock.now();
        const actualElapsed = loopEndTime - loopStartTime;
        const lag = actualElapsed - this.expectedElapsedTimeMs;
        this.lastLoopEndTime = loopEndTime;
        return lag;
    }

    public stop() : void {
        this.started = false;
        if(this.handle == null) return;
        this.clearTimeoutFn(this.handle);
        delete this.handle;
    }
}