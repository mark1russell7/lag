export type MetricKind = "histogram" | "counter";

/** One OpenTelemetry instrument that a monitor records. */
export type MetricRow = {
    /** The instrument name, for example `lag_drift_histogram`. */
    name : string;
    kind : MetricKind;
    /** The unit, as the instrument declares it, for example `ms` or `{transition}`. */
    unit : string;
    /** The attribute keys. Values are fixed enums, never measured values. */
    attributes? : readonly string[];
    description : string;
};
