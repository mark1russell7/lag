export type PerformanceLike = {
    now : () => number;
    timeOrigin : number;
};

const HIGH_RES_THRESHOLD_MS = 0.005;   // 5μs — indicates Cross-Origin-Isolation
const STALE_ORIGIN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export class ClockReliabilityChecker {
    constructor(
        private readonly performance : PerformanceLike,
    ) {}

    getResolutionMs() : number {
        let minDelta = Infinity;
        let prev = this.performance.now();

        // Take 100 rapid samples, find minimum non-zero delta
        for (let i = 0; i < 100; i++) {
            const curr = this.performance.now();
            const delta = curr - prev;
            if (delta > 0 && delta < minDelta) {
                minDelta = delta;
            }
            prev = curr;
        }

        return minDelta === Infinity ? 0 : minDelta;
    }

    isCrossOriginIsolated() : boolean {
        return this.getResolutionMs() <= HIGH_RES_THRESHOLD_MS;
    }

    isTimeOriginStale(currentWallClockMs : number) : boolean {
        const age = currentWallClockMs - this.performance.timeOrigin;
        return age > STALE_ORIGIN_THRESHOLD_MS;
    }
}
