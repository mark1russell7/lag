import type { Measurement, RunReport } from "../../adapters/lag-report";
import { summarize, type Summary } from "../../lib/stats";

/**
 * Measurements of the same metric, from different suites or profiles. The
 * metric is the last part of the measurement name: the family of
 * "stress/heavy/lag_drift_histogram" is "lag_drift_histogram".
 */
export type MeasurementFamily = {
    key : string;
    metric : string;
    unit : string;
    measurements : readonly Measurement[];
};

export function metricOf(name : string) : string {
    const segments = name.split("/");
    return segments[segments.length - 1] ?? name;
}

export function measurementFamilies(run : RunReport) : MeasurementFamily[] {
    const families = new Map<string, { metric : string; unit : string; measurements : Measurement[] }>();
    for (const measurement of run.measurements) {
        const metric = metricOf(measurement.name);
        const key = `${metric} (${measurement.unit})`;
        const family = families.get(key) ?? { metric, unit : measurement.unit, measurements : [] };
        family.measurements.push(measurement);
        families.set(key, family);
    }
    return [...families].map(([key, family]) => ({ key, ...family })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Group by the full measurement name. */
export const GROUP_BY_MEASUREMENT = "measurement";
/** Group by the suite that recorded the values. */
export const GROUP_BY_SUITE = "suite";

/** The keys that the reader can group by: the measurement, the suite, and every label key. */
export function groupingKeys(measurements : readonly Measurement[]) : string[] {
    const labels = new Set<string>();
    for (const measurement of measurements) {
        for (const key of Object.keys(measurement.labels)) labels.add(key);
    }
    return [GROUP_BY_MEASUREMENT, GROUP_BY_SUITE, ...[...labels].sort()];
}

/** A label key that most measurements share, or the measurement name. */
export function defaultGroupingKey(measurements : readonly Measurement[], preferred : readonly string[] = ["profile", "browser"]) : string {
    for (const key of preferred) {
        if (measurements.some(measurement => key in measurement.labels)) return key;
    }
    return GROUP_BY_MEASUREMENT;
}

export function groupValue(measurement : Measurement, key : string) : string {
    if (key === GROUP_BY_MEASUREMENT) return measurement.name;
    if (key === GROUP_BY_SUITE) return measurement.suiteId;
    return measurement.labels[key] ?? "(none)";
}

export type MeasurementGroup = {
    group : string;
    values : readonly number[];
    /** The names of the measurements in the group. */
    sources : readonly string[];
    summary : Summary;
};

export const OTHER_GROUP = "Other";

/**
 * This function joins the values of the measurements by the value of a key.
 * Past `maxGroups`, the smallest groups fold into one "Other" group, so a
 * chart does not need more colors than the palette has.
 */
export function groupMeasurements(measurements : readonly Measurement[], key : string, maxGroups = 8) : MeasurementGroup[] {
    const groups = new Map<string, { values : number[]; sources : string[] }>();
    for (const measurement of measurements) {
        const name = groupValue(measurement, key);
        const group = groups.get(name) ?? { values : [], sources : [] };
        group.values.push(...measurement.values);
        group.sources.push(measurement.name);
        groups.set(name, group);
    }

    let entries = [...groups].map(([group, { values, sources }]) => ({ group, values, sources }));
    if (entries.length > maxGroups) {
        const bySize = [...entries].sort((a, b) => b.values.length - a.values.length || a.group.localeCompare(b.group));
        const kept = new Set(bySize.slice(0, maxGroups - 1).map(entry => entry.group));
        const folded = entries.filter(entry => !kept.has(entry.group));
        entries = [
            ...entries.filter(entry => kept.has(entry.group)),
            {
                group : OTHER_GROUP,
                values : folded.flatMap(entry => entry.values),
                sources : folded.flatMap(entry => entry.sources),
            },
        ];
    }
    return entries
        .sort((a, b) => (a.group === OTHER_GROUP ? 1 : b.group === OTHER_GROUP ? -1 : a.group.localeCompare(b.group)))
        .map(entry => ({ ...entry, summary : summarize(entry.values) }));
}
