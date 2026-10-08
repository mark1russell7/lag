import { lagLoggingIntervalMs, longLagDuration, longLagThreshold, shortLagDuration, shortLagThreshold } from "./constants.js";
import type { EventLoopLagAttributes, LagMeasurement, Logger } from "./types.js";

type LagWindow = {
    duration : number;
    threshold : number;
    max : number;
};

type Sample = {
    lagMs : number;
    intervalMs : number;
};

/**
 * This class logs sustained lag. It examines the most recent 2 s and 5 s of
 * measurements, by time. The lag of a period is the sum of the lags divided
 * by the sum of the intervals, as a percentage. A period goes above its
 * threshold at more than 100% (2 s) or more than 50% (5 s). Each 30 s of
 * measurements, the logger writes one warning for each period that went
 * above its threshold, with the largest value.
 *
 * The intervals come from the measurements. Thus, the periods stay correct
 * when the windows of a monitor are not 100 ms long, for example in Firefox
 * and WebKit on Windows.
 */
export class LagLogger {
    private samples : Sample[] = [];
    private samplesMs = 0;
    private msSinceLastReport = 0;
    private readonly lagWindows : LagWindow[];
    private readonly maxWindowMs : number;

    constructor(
        /** The interval of a measurement that does not give `intervalMs`. */
        private readonly measurementIntervalMs : number,
        private logger : Logger,
    ) {
        this.lagWindows = [
            { duration : shortLagDuration, threshold : shortLagThreshold, max : 0 },
            { duration : longLagDuration, threshold : longLagThreshold, max : 0 },
        ];
        this.maxWindowMs = Math.max(...this.lagWindows.map(w => w.duration));
    }

    public addMeasurement({ value, attributes, intervalMs } : LagMeasurement) : void {
        if (attributes.wasHidden) {
            return;
        }

        const interval = intervalMs !== undefined && intervalMs > 0 ? intervalMs : this.measurementIntervalMs;
        this.samples.push({ lagMs : value, intervalMs : interval });
        this.samplesMs += interval;
        // Keep the samples of the longest period
        while (this.samples.length > 1 && this.samplesMs - this.samples[0]!.intervalMs >= this.maxWindowMs) {
            this.samplesMs -= this.samples.shift()!.intervalMs;
        }

        for (const window of this.lagWindows) {
            window.max = this.calculateNewMaxLag(window);
        }

        this.msSinceLastReport += interval;
        if (this.msSinceLastReport >= lagLoggingIntervalMs) {
            for (const window of this.lagWindows) {
                this.reportLag(window, attributes);
            }
            this.reset();
        }
    }

    private reset() : void {
        for (const window of this.lagWindows) {
            window.max = 0;
        }
        this.msSinceLastReport = 0;
        this.samples = [];
        this.samplesMs = 0;
    }

    private reportLag(
        { max, threshold, duration } : LagWindow,
        attributes : EventLoopLagAttributes,
    ) : void {
        if (max > 0) {
            this.logger.log(
                "warn",
                "Average event loop lag exceeded threshold",
                {
                    ...attributes,
                    type : "LagMonitor",
                    subtype : "LagLogger",
                    threshold,
                    duration,
                    lag : max.toFixed(1),
                },
            );
        }
    }

    /** The lag of the most recent samples that cover the period, if it is above the threshold. */
    private calculateNewMaxLag({ max, duration, threshold } : LagWindow) : number {
        let lag = 0;
        let covered = 0;
        for (let i = this.samples.length - 1; i >= 0 && covered < duration; i--) {
            lag += this.samples[i]!.lagMs;
            covered += this.samples[i]!.intervalMs;
        }
        if (covered < duration) {
            return max;
        }
        const average = (lag / covered) * 100;
        return average > threshold ? Math.max(max, average) : max;
    }
}
