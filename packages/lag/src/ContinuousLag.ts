import { LagMonitor } from "./LagMonitor.js";


export class ContinuousLag extends LagMonitor {
    private lastLoopEndTime : number = this.clock.now();
    private handle?: number;
    private started: boolean = false;
    public start() : void {
        if(this.started) return;
        this.started = true;
        this.startMeasurementLoop();
    }

    private startMeasurementLoop() : void {
        this.handle = this.setTimeoutFn(() => {
            try{
                this.report(this.measure());
            }catch(error){
                this.logger.log(
                    'error', 'Error measuring/reporting lag.', 
                {
                    error,
                    type : 'LagMonitor',
                    subtype : 'ContinuousLag',
                });
            }finally{
                this.startMeasurementLoop();
            }
        }, this.expectedElapsedTimeMs);
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