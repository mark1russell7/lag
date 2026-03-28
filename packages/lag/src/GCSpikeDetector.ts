const DEFAULT_WINDOW_SIZE = 50;
const DEFAULT_SPIKE_MULTIPLIER = 10;

export class GCSpikeDetector {
    private values : number[] = [];

    constructor(
        private readonly windowSize : number = DEFAULT_WINDOW_SIZE,
        private readonly spikeMultiplier : number = DEFAULT_SPIKE_MULTIPLIER,
    ) {}

    classify(value : number) : { likelyGCPause : boolean } {
        this.values.push(value);
        if (this.values.length > this.windowSize) {
            this.values.shift();
        }

        const median = this.getMedian();

        return {
            likelyGCPause : median > 0 && value > median * this.spikeMultiplier,
        };
    }

    private getMedian() : number {
        if (this.values.length === 0) return 0;

        const sorted = [...this.values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1]! + sorted[mid]!) / 2;
        }
        return sorted[mid]!;
    }

    reset() : void {
        this.values = [];
    }
}
