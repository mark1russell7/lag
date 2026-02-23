import { lagLoggingIntervalMs, longLagDuration, longLagThreshold, shortLagDuration, shortLagThreshold } from "./constants.js";
import type { EventLoopLagAttributes, LagMeasurement, Logger } from "./types.js";

type LagWindow = {
    duration : number;
    threshold : number;
    windowSize : number;
    max : number;
}

export class LagLogger {
    private samples : number[] = [];
    private measurementsSinceLastReport : number = 0;
    private measurementsPerReport : number;

    private readonly lagWindows : LagWindow[];

    constructor(
        private readonly measumentIntervalMs : number,
        private logger : Logger
    ){
        this.measurementsPerReport = Math.ceil( lagLoggingIntervalMs / this.measumentIntervalMs);
        this.lagWindows = [
            {
                duration : shortLagDuration,
                threshold : shortLagThreshold,
                windowSize : Math.ceil(shortLagDuration / this.measumentIntervalMs),
                max : 0,
            },
            {
                duration : longLagDuration,
                threshold : longLagThreshold,
                windowSize : Math.ceil(longLagDuration / this.measumentIntervalMs),
                max : 0,
            }
        ]
    }

    public addMeasurement({value, attributes} : LagMeasurement) : void {
        if(attributes.wasHidden) {
            return;
        }

        const utilization = (value / this.measumentIntervalMs) * 100;
        this.samples.push(utilization);

        const maxWindowSize = Math.max(...this.lagWindows.map(w => w.windowSize));
        if(this.samples.length > maxWindowSize) {
            this.samples.shift();
        }

        for(const window of this.lagWindows) {
            window.max = this.calculateNewMaxLag(window);
        }

        this.measurementsSinceLastReport++;

        if(this.measurementsSinceLastReport >= this.measurementsPerReport) {
            for(const window of this.lagWindows) {
                this.reportLag(window, attributes);
            }
            this.reset();
        }
    }
    private reset() : void {
        for(const window of this.lagWindows) {
            window.max = 0;
        }
        this.measurementsSinceLastReport = 0;
        this.samples = [];
    }
    private reportLag(
        {max, threshold, duration} : LagWindow,
        attributes : EventLoopLagAttributes
    ) : void { 
        if(max > 0){
            this.logger.log(
                'warn',
                'Average event loop lag exceeded threshold',
                {
                    ...attributes,
                    type : 'LagMonitor',
                    subtype : 'LagLogger',
                    threshold,
                    duration,
                    lag : max.toFixed(1)
                }
            );
        }
    }

    private calculateNewMaxLag({max, windowSize, threshold} : LagWindow) : number {
        if(this.samples.length < windowSize) {
            return max;
        }
        const relevantSamples = this.samples.slice(-windowSize);
        const sum = relevantSamples.reduce((acc, val) => acc + val, 0);
        const avg = sum / windowSize;
        return avg > threshold ? Math.max(max, avg) : max;
    }
}