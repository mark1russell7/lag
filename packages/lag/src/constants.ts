/** DriftLag timer step. Just above the 4ms clamp browsers apply to nested timers. */
export const driftStepMs                            = 5     as const;
/**
 * LagLogger thresholds, as lag-to-interval percentages. The short window
 * tolerates a higher burst (100% = as much lag as wall time) than the long
 * window tolerates sustained (50%).
 */
export const shortLagThreshold                      = 100   as const;
export const longLagThreshold                       = 50    as const;
export const macrotaskLagIntervalMs                 = 5_000 as const;
export const highFrequencyLagIntervalMs : number    = driftStepMs * 20; // 100ms
export const shortLagDuration           : number    = highFrequencyLagIntervalMs * 20; // 2000ms
export const longLagDuration            : number    = highFrequencyLagIntervalMs * 50; // 5000ms
export const lagLoggingIntervalMs       : number    = highFrequencyLagIntervalMs * 300; // 30_000ms
