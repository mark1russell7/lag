/**
 * The default timer step of `DriftLag`, in milliseconds. The value is 1 ms
 * more than the 4 ms minimum delay that browsers apply to nested timers.
 */
export const driftStepMs                            = 5     as const;
/**
 * The thresholds of `LagLogger`, as percentages of lag to interval. The short
 * window accepts a burst of lag up to 100%, that is, as much lag as wall
 * time. The long window accepts sustained lag up to 50%.
 */
export const shortLagThreshold                      = 100   as const;
export const longLagThreshold                       = 50    as const;
export const macrotaskLagIntervalMs                 = 5_000 as const;
export const highFrequencyLagIntervalMs : number    = driftStepMs * 20; // 100ms
export const shortLagDuration           : number    = highFrequencyLagIntervalMs * 20; // 2000ms
export const longLagDuration            : number    = highFrequencyLagIntervalMs * 50; // 5000ms
export const lagLoggingIntervalMs       : number    = highFrequencyLagIntervalMs * 300; // 30_000ms
