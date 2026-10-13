import { percentile, sortedValues } from "../../lib/stats";

/**
 * The model of the worked example of the statistics page. A visible period
 * has one block of the main thread. The model gives the samples of a
 * closed-loop probe (DriftLag) and of an open-loop probe (the worker heartbeat).
 */

export type ProbeScenario = {
    /** The visible period, in ms. */
    periodMs : number;
    /** The block of the main thread, in ms from the start of the period. */
    block : { readonly start : number; readonly duration : number };
    /** The window of DriftLag: approximately 100 ms. */
    windowMs : number;
    /** The interval of the worker heartbeats: 1 s by default. */
    heartbeatMs : number;
};

export type ProbeSample = {
    /** For DriftLag: the end of the window. For a heartbeat: its send time. In ms. */
    time : number;
    /** The lag of the window, or the delay of the heartbeat, in ms. */
    value : number;
};

export type ProbeStatistics = {
    count : number;
    /** The number of samples of 1 s or more. */
    longCount : number;
    p95 : number | undefined;
    mean : number | undefined;
    sum : number;
};

/** The block, cut to the period. */
function blockIn(scenario : ProbeScenario) : { start : number; end : number } {
    const start = Math.min(Math.max(0, scenario.block.start), scenario.periodMs);
    return { start, end : Math.min(scenario.periodMs, start + Math.max(0, scenario.block.duration)) };
}

/**
 * The windows of DriftLag. The idle time gives windows with a lag of 0. The
 * block delays one window, which gets the duration of the block as its lag.
 * A closed-loop probe waits for the main thread, thus it takes no samples
 * during the block.
 */
export function closedLoopSamples(scenario : ProbeScenario) : ProbeSample[] {
    const { start, end } = blockIn(scenario);
    const duration = end - start;
    const samples : ProbeSample[] = [];
    let time = 0;
    let blocked = false;
    while (time + scenario.windowMs <= scenario.periodMs + 1e-9) {
        if (!blocked && duration > 0 && time + scenario.windowMs > start) {
            // The window that contains the start of the block ends after the block
            time += scenario.windowMs + duration;
            samples.push({ time, value : duration });
            blocked = true;
            continue;
        }
        time += scenario.windowMs;
        samples.push({ time, value : 0 });
    }
    return samples;
}

/**
 * The heartbeats of the worker, one each `heartbeatMs` from the start of the
 * period. A heartbeat that the worker sends during the block waits until the
 * end of the block. The worker sends on its own schedule, thus it also
 * samples the block.
 */
export function openLoopSamples(scenario : ProbeScenario) : ProbeSample[] {
    const { start, end } = blockIn(scenario);
    const samples : ProbeSample[] = [];
    for (let time = 0; time < scenario.periodMs - 1e-9; time += scenario.heartbeatMs) {
        samples.push({ time, value : time >= start && time < end ? end - time : 0 });
    }
    return samples;
}

export function statisticsOf(samples : readonly ProbeSample[]) : ProbeStatistics {
    const values = sortedValues(samples.map(sample => sample.value));
    const sum = values.reduce((total, value) => total + value, 0);
    return {
        count : values.length,
        longCount : values.filter(value => value >= 1_000).length,
        p95 : percentile(values, 95),
        mean : values.length > 0 ? sum / values.length : undefined,
        sum,
    };
}

/** The mean delay of an event at a random time of the period: L² / 2 / T for one block of length L. */
export function randomEventDelay(scenario : ProbeScenario) : number {
    const { start, end } = blockIn(scenario);
    return scenario.periodMs > 0 ? (end - start) ** 2 / 2 / scenario.periodMs : 0;
}
