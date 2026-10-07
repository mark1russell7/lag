/** The result of one clock synchronization. */
export type ClockSyncResult = {
    /** Worker clock minus main-thread clock, from the sample with the shortest round trip. */
    offsetMs : number;
    /** The round-trip time of that sample. Half of it is the uncertainty of the offset. */
    roundTripMs : number;
};

const DEFAULT_SAMPLES = 5;
/** An offset inside the uncertainty plus this margin is treated as 0. */
const ALIGNED_MARGIN_MS = 1;

/**
 * Estimates the offset between the worker clock and the main-thread clock
 * with an NTP-style exchange: the main thread sends a request at `t0`, the
 * worker answers with its time `t1`, and the answer arrives at `t2`. Then
 * `offset = t1 - (t0 + t2) / 2`, with an uncertainty of `(t2 - t0) / 2`. Of
 * several exchanges, the one with the shortest round trip is the most exact.
 *
 * The HR-Time specification aligns `timeOrigin + now()` across a window and
 * its workers. The exchange checks this in each browser, and the monitor
 * corrects its measurements when the clocks do not agree.
 */
export class WorkerClockSync {
    private nextId = 1;
    private sentAt = new Map<number, number>();
    private samples : ClockSyncResult[] = [];
    private remaining = 0;
    private result : ClockSyncResult | undefined;

    constructor(
        private readonly sendRequest : (id : number) => void,
        private readonly nowAbsolute : () => number,
        private readonly onResult : (result : ClockSyncResult) => void,
        private readonly sampleCount : number = DEFAULT_SAMPLES,
    ) {}

    /** Starts a new synchronization. An unfinished one is discarded. */
    begin() : void {
        this.sentAt.clear();
        this.samples = [];
        this.remaining = this.sampleCount;
        this.sendNext();
    }

    /** Call this for each `sync-reply` from the worker. */
    onReply(id : number, workerTime : number) : void {
        const t0 = this.sentAt.get(id);
        if (t0 === undefined) return;
        this.sentAt.delete(id);
        const t2 = this.nowAbsolute();
        this.samples.push({ offsetMs : workerTime - (t0 + t2) / 2, roundTripMs : t2 - t0 });

        if (this.remaining > 0) {
            this.sendNext();
            return;
        }
        const best = this.samples.reduce((a, b) => (b.roundTripMs < a.roundTripMs ? b : a));
        this.result = best;
        this.onResult(best);
    }

    /**
     * The correction to add to a worker-to-main delay: the measured offset, or
     * 0 while the offset is inside its uncertainty (the clocks agree).
     */
    getCorrectionMs() : number {
        if (!this.result) return 0;
        const uncertainty = this.result.roundTripMs / 2 + ALIGNED_MARGIN_MS;
        return Math.abs(this.result.offsetMs) > uncertainty ? this.result.offsetMs : 0;
    }

    getResult() : ClockSyncResult | undefined {
        return this.result;
    }

    private sendNext() : void {
        this.remaining--;
        const id = this.nextId++;
        this.sentAt.set(id, this.nowAbsolute());
        this.sendRequest(id);
    }
}
