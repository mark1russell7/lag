import type { Clock, Logger, SetIntervalFn, ClearIntervalFn } from "./types.js";

// Chrome-only legacy API: performance.memory
export type LegacyMemory = {
    usedJSHeapSize : number;
    totalJSHeapSize : number;
    jsHeapSizeLimit : number;
};

// Standard API: performance.measureUserAgentSpecificMemory()
// Requires cross-origin isolation. Returns a promise.
export type MeasureMemoryResult = {
    bytes : number;
    breakdown : Array<{
        bytes : number;
        attribution : Array<{ url? : string; scope? : string }>;
        types : string[];
    }>;
};

export type MemorySource = {
    // Synchronous Chrome API
    readLegacy? : () => LegacyMemory | undefined;
    // Async standard API (cross-origin isolated only)
    measureModern? : () => Promise<MeasureMemoryResult>;
};

export type MemoryMeasurement = {
    source : "legacy" | "modern";
    usedBytes : number;
    totalBytes : number | undefined;
    limitBytes : number | undefined;
    usagePercent : number | undefined;
    timestamp : number;
};

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Periodically samples JS heap memory.
 *
 * Two sources:
 * - **Legacy** `performance.memory` (Chrome only, non-standard, no permissions needed)
 * - **Modern** `performance.measureUserAgentSpecificMemory()` (standard, requires
 *   Cross-Origin-Isolation headers, async, more accurate)
 *
 * The monitor uses the modern API if available, and falls back to legacy for
 * good once the modern API fails. A slow upward trend in usedBytes points at a
 * leak.
 */
export class MemoryMonitor {
    private handle : number | undefined;
    private started = false;
    /** The modern API can take many seconds (it waits for a GC); never overlap samples. */
    private sampling = false;
    private modernFailed = false;

    constructor(
        private readonly intervalMs : number,
        private readonly source : MemorySource,
        private readonly report : (measurement : MemoryMeasurement) => void,
        private readonly logger : Logger,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        private readonly clock : Clock,
    ) {
        this.start();
    }

    start() : void {
        if (this.started) return;
        this.started = true;
        // Take an immediate sample, then schedule periodic samples
        void this.sample();
        this.handle = this.setIntervalFn(() => { void this.sample(); }, this.intervalMs);
    }

    stop() : void {
        this.started = false;
        if (this.handle !== undefined) {
            this.clearIntervalFn(this.handle);
            this.handle = undefined;
        }
    }

    private async sample() : Promise<void> {
        if (!this.started || this.sampling) return;
        this.sampling = true;

        try {
            const measurement = (await this.measureModern()) ?? this.readLegacy();
            // stop() may have been called while the modern API was pending
            if (measurement && this.started) {
                this.report(measurement);
            }
        } catch (error) {
            this.logger.log("error", "Error in memory measurement.", {
                error,
                type : "MemoryMonitor",
            });
        } finally {
            this.sampling = false;
        }
    }

    /** Prefer the modern API: more accurate, and includes workers. */
    private async measureModern() : Promise<MemoryMeasurement | undefined> {
        if (!this.source.measureModern || this.modernFailed) return undefined;
        try {
            const result = await this.source.measureModern();
            return {
                source : "modern",
                usedBytes : result.bytes,
                totalBytes : undefined,
                limitBytes : undefined,
                usagePercent : undefined,
                timestamp : this.clock.now(),
            };
        } catch (error) {
            this.modernFailed = true;
            this.logger.log("debug", "measureUserAgentSpecificMemory failed; using legacy performance.memory from now on.", {
                error,
                type : "MemoryMonitor",
            });
            return undefined;
        }
    }

    private readLegacy() : MemoryMeasurement | undefined {
        const legacy = this.source.readLegacy?.();
        if (!legacy) return undefined;
        return {
            source : "legacy",
            usedBytes : legacy.usedJSHeapSize,
            totalBytes : legacy.totalJSHeapSize,
            limitBytes : legacy.jsHeapSizeLimit,
            usagePercent : legacy.jsHeapSizeLimit > 0
                ? (legacy.usedJSHeapSize / legacy.jsHeapSizeLimit) * 100
                : undefined,
            timestamp : this.clock.now(),
        };
    }
}

export const defaultMemoryIntervalMs : number = DEFAULT_INTERVAL_MS;
