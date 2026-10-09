import { useId } from "react";
import { useSearchParams } from "react-router";
import { PlotFigure } from "../../components/PlotFigure/PlotFigure";
import { ScrollTable } from "../../components/ScrollTable/ScrollTable";
import { seriesColor, useThemeColors } from "../../theme/colors";
import { formatMeasurementValue, LINE_DASHES, measurementEcdf, measurementHistogram } from "../charts";
import { ChartLegend } from "../components/ChartLegend";
import { EmptySection } from "../components/States";
import {
    familyGroupingKey,
    GROUP_BY_MEASUREMENT,
    GROUP_BY_SUITE,
    groupingKeys,
    groupMeasurements,
    measurementFamilies,
    type MeasurementFamily,
} from "../model/measurements";
import { useRunContext } from "./run-context";
import styles from "./Results.module.css";

/** The value of the grouping select for the default grouping of each family. */
const DEFAULT_GROUPING = "";

function keyLabel(key : string) : string {
    if (key === DEFAULT_GROUPING) return "The default of each metric";
    if (key === GROUP_BY_MEASUREMENT) return "Measurement name";
    if (key === GROUP_BY_SUITE) return "Suite";
    return `Label: ${key}`;
}

function FamilySection({ family, groupBy } : { family : MeasurementFamily; groupBy : string }) {
    const headingId = useId();
    const theme = useThemeColors();
    const groups = groupMeasurements(family.measurements, groupBy);
    const legend = groups.map((group, index) => ({
        label : group.group,
        color : seriesColor(theme, index),
        shape : "line" as const,
        dash : LINE_DASHES[index] ?? "",
    }));
    return (
        <section className={styles.block} aria-labelledby={headingId}>
            <h2 id={headingId}><code>{family.metric}</code></h2>
            <p className={styles.lead}>
                {family.measurements.length} {family.measurements.length === 1 ? "measurement" : "measurements"} in{" "}
                <code>{family.unit}</code>, grouped by {keyLabel(groupBy).toLowerCase()}. Percentiles use the nearest-rank method.
            </p>
            <ScrollTable label={`Percentiles of ${family.metric}`}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th scope="col">Group</th>
                            <th scope="col" data-align="right">Values</th>
                            <th scope="col" data-align="right">p50</th>
                            <th scope="col" data-align="right">p95</th>
                            <th scope="col" data-align="right">p99</th>
                            <th scope="col" data-align="right">Maximum</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(group => (
                            <tr key={group.group}>
                                <th scope="row">{group.group}</th>
                                <td data-align="right">{group.summary.count}</td>
                                <td data-align="right">{formatMeasurementValue(group.summary.p50, family.unit)}</td>
                                <td data-align="right">{formatMeasurementValue(group.summary.p95, family.unit)}</td>
                                <td data-align="right">{formatMeasurementValue(group.summary.p99, family.unit)}</td>
                                <td data-align="right">{formatMeasurementValue(group.summary.max, family.unit)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollTable>
            <ChartLegend label={`Groups of ${family.metric}`} items={legend} />
            <div className={styles.chartPair}>
                <PlotFigure
                    title={`Histogram of ${family.metric}, one panel for each group`}
                    description="Each panel counts the values of one group in ranges. The ranges are equal on a log(1 + x) scale, so the long tail shows."
                    options={measurementHistogram(groups, family.unit)}
                />
                <PlotFigure
                    title={`Cumulative distribution of ${family.metric}`}
                    description="For each group, a line shows the fraction of values at or below each value. Lines that are more to the right have slower values. The guides show p50, p95 and p99."
                    options={measurementEcdf(groups, family.unit)}
                />
            </div>
        </section>
    );
}

/** The measured value sets of a run: a histogram, a cumulative distribution and percentiles for each metric. */
export function MeasurementsView() {
    const { run } = useRunContext();
    const [params, setParams] = useSearchParams();
    const groupId = useId();
    const metricId = useId();

    if (run.measurements.length === 0) return <EmptySection text="This run has no measurements." />;

    const families = measurementFamilies(run);
    const keys = groupingKeys(run.measurements);
    const requestedGroup = params.get("group");
    // Without a valid selection, each family takes its own default: a label that the family has
    const selectedGroup = requestedGroup && keys.includes(requestedGroup) ? requestedGroup : DEFAULT_GROUPING;
    const requestedMetric = params.get("metric") ?? "";
    const shown = families.filter(family => requestedMetric === "" || family.key === requestedMetric);

    const update = (key : string, value : string) : void => {
        setParams((previous) => {
            const next = new URLSearchParams(previous);
            if (value) next.set(key, value);
            else next.delete(key);
            return next;
        }, { replace : true });
    };

    return (
        <>
            <div className={styles.filters}>
                <div className={styles.field}>
                    <label htmlFor={groupId}>Group and color by</label>
                    <select id={groupId} className="control" value={selectedGroup} onChange={(event) => update("group", event.target.value)}>
                        {[DEFAULT_GROUPING, ...keys].map(key => <option key={key} value={key}>{keyLabel(key)}</option>)}
                    </select>
                </div>
                <div className={styles.field}>
                    <label htmlFor={metricId}>Metric</label>
                    <select id={metricId} className="control" value={requestedMetric} onChange={(event) => update("metric", event.target.value)}>
                        <option value="">All</option>
                        {families.map(family => <option key={family.key} value={family.key}>{family.key}</option>)}
                    </select>
                </div>
            </div>
            {shown.map(family => <FamilySection key={family.key} family={family} groupBy={familyGroupingKey(family, requestedGroup, keys)} />)}
        </>
    );
}
