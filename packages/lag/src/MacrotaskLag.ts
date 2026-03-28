import { LagMonitor } from "./LagMonitor.js";

export class MacrotaskLag  extends LagMonitor{
    private handle?: number;
    private started : boolean = false;
    public start() : void {
        if(this.started) return;
        this.started = true;
        const measureAndReport = async () : Promise<void> => {
            try {
                this.report(await this.measure());
            }catch(error){
                this.logger.log(
                    'error',
                    'Error measuring/reporting lag.',
                    {
                        error,
                        type : 'LagMonitor',
                        subtype : 'MacrotaskLag',
                    }
                );
            }
        };
        this.handle = this.setIntervalFn(() => {
            void measureAndReport();
        }, this.expectedElapsedTimeMs);
    }
    async measure() : Promise<number> {
        return new Promise(resolve => {
            const start : number = this.clock.now();
            this.setTimeoutFn(() => {
                resolve(this.clock.now() - start);
            }, 0)
            
        });
    }
    public stop() : void {
        this.started = false;
        if(this.handle == null) return;
        this.clearIntervalFn(this.handle);
        delete this.handle;
    }
}