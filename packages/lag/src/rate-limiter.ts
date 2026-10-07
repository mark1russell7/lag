import type { Clock } from "./types.js";

/**
 * Permits at most `limit` actions in each window of `windowMs`. Use it to
 * keep event volume small, for example one attribution event for each long
 * frame.
 */
export class RateLimiter {
    private windowStart = -Infinity;
    private used = 0;

    constructor(
        private readonly clock : Clock,
        private readonly limit : number,
        private readonly windowMs : number,
    ) {}

    /** True if the action is permitted now. A permitted action uses one unit of the limit. */
    tryAcquire() : boolean {
        const now = this.clock.now();
        if (now - this.windowStart >= this.windowMs) {
            this.windowStart = now;
            this.used = 0;
        }
        if (this.used >= this.limit) return false;
        this.used++;
        return true;
    }
}

/**
 * Removes the query string and the fragment from a URL. They can contain
 * tokens or personal data, and they make values unique.
 */
export function stripUrlParameters(url : string) : string {
    const end = url.search(/[?#]/);
    return end < 0 ? url : url.slice(0, end);
}
