import { useId, useMemo, useState } from "react";
import { HISTOGRAM_BOUNDARIES } from "../../adapters/lag-core";
import { PlotFigure, type Markish } from "../../components/PlotFigure/PlotFigure";
import { formatMs, formatNumber } from "../../lib/format";
import { seriesColor, useThemeColors } from "../../theme/colors";
import { Explainer, explainerStyles } from "../Explainer";
import { aggregate, type BrowserLoad } from "./histogram-model";
import styles from "./HistogramMerge.module.css";

const SPREAD = 0.55;

const INITIAL : readonly BrowserLoad[] = [
    { name : "Desktop computers", samples : 4_000, medianMs : 20, spread : SPREAD },
    { name : "Laptops", samples : 1_500, medianMs : 45, spread : SPREAD },
    { name : "Phones", samples : 300, medianMs : 160, spread : SPREAD },
];

const BOUNDARIES = HISTOGRAM_BOUNDARIES.duration;

function signedMs(ms : number) : string {
    return ms < 0 ? `−${formatMs(-ms)}` : `+${formatMs(ms)}`;
}

/** A short line in the style of a rule of the chart, as the legend of that rule. */
function RuleSwatch({ color, dash, width = 2 } : { color : string; dash? : string; width? : number }) {
    return (
        <svg width="22" height="10" aria-hidden="true" focusable="false" className={styles.swatch}>
            <line x1="1" x2="21" y1="5" y2="5" stroke={color} strokeWidth={width} {...(dash ? { strokeDasharray : dash } : {})} />
        </svg>
    );
}

/**
 * The aggregation explainer: three groups of browsers with different loads.
 * The mean of their 95th percentiles is not the 95th percentile of all
 * samples. The merged histogram buckets give that value, with an error that
 * is less than the width of one bucket.
 */
export default function HistogramMerge() {
    const [loads, setLoads] = useState<readonly BrowserLoad[]>(INITIAL);
    const colors = useThemeColors();
    const baseId = useId();
    const result = useMemo(() => aggregate(loads, BOUNDARIES), [loads]);
    const update = (index : number, change : Partial<BrowserLoad>) : void => {
        setLoads(previous => previous.map((load, position) => (position === index ? { ...load, ...change } : load)));
    };

    const pooled = result.pooled ?? 0;
    const meanError = (result.meanOfPercentiles ?? 0) - pooled;
    const histogramError = (result.fromHistogram ?? 0) - pooled;
    const rows = result.buckets.flatMap(bucket => bucket.counts.map((count, index) => ({
        browser : loads[index]!.name,
        lower : Math.max(bucket.lower, 1),
        upper : Number.isFinite(bucket.upper) ? bucket.upper : bucket.lower * 2,
        count,
    }))).filter(row => row.count > 0);

    return (
        <Explainer
            title="Merge the histograms of three groups of browsers"
            caption={
                <>
                    The samples follow log-normal distributions at equal steps of probability, thus the same settings always give
                    the same result. The buckets are the boundaries of the duration histograms of the library. The estimate
                    interpolates in the bucket of the rank, as <code>histogram_quantile()</code> of PromQL does.
                </>
            }
        >
            <div className={styles.loads}>
                {loads.map((load, index) => (
                    <fieldset key={load.name} className={styles.load}>
                        <legend className={styles.loadName}>
                            <span className={styles.dot} style={{ background : seriesColor(colors, index) }} aria-hidden="true" />
                            {load.name}
                        </legend>
                        <label className={explainerStyles.field} htmlFor={`${baseId}-samples-${index}`}>
                            <span className={explainerStyles.fieldLabel}>
                                Samples <span className={explainerStyles.fieldValue}>{formatNumber(load.samples, 0)}</span>
                            </span>
                            <input
                                id={`${baseId}-samples-${index}`} type="range" min={100} max={5_000} step={100} value={load.samples}
                                onChange={event => update(index, { samples : Number(event.target.value) })}
                            />
                        </label>
                        <label className={explainerStyles.field} htmlFor={`${baseId}-median-${index}`}>
                            <span className={explainerStyles.fieldLabel}>
                                Median latency <span className={explainerStyles.fieldValue}>{formatMs(load.medianMs)}</span>
                            </span>
                            <input
                                id={`${baseId}-median-${index}`} type="range" min={5} max={400} step={1} value={load.medianMs}
                                onChange={event => update(index, { medianMs : Number(event.target.value) })}
                            />
                        </label>
                        <p className={styles.loadP95}>p95 of this group: <strong>{result.browsers[index]?.p95 === undefined ? "–" : formatMs(result.browsers[index]!.p95!)}</strong></p>
                    </fieldset>
                ))}
            </div>

            <PlotFigure
                title="The merged histogram of all samples"
                description={`Bars: the number of samples in each bucket, stacked for each group. Lines: the 95th percentile of all samples (${formatMs(pooled)}), the estimate from the merged buckets (${formatMs(result.fromHistogram ?? 0)}) and the mean of the percentiles of the groups (${formatMs(result.meanOfPercentiles ?? 0)}).`}
                hideTitle
                height={220}
                options={({ Plot, theme }) => {
                    const marks : Markish[] = [
                        Plot.rectY(rows, {
                            x1 : "lower",
                            x2 : "upper",
                            y : "count",
                            fill : "browser",
                            insetLeft : 1,
                            insetRight : 1,
                            tip : true,
                            title : (row : (typeof rows)[number]) => `${row.browser}\n${formatMs(row.lower)} to ${formatMs(row.upper)}: ${formatNumber(row.count, 0)} samples`,
                        }),
                        Plot.ruleY([0], { stroke : theme.chartAxis }),
                        Plot.ruleX([pooled], { stroke : theme.ink, strokeWidth : 2 }),
                        Plot.ruleX([result.fromHistogram ?? 0], { stroke : theme.accent, strokeWidth : 2, strokeDasharray : "6 4" }),
                        Plot.ruleX([result.meanOfPercentiles ?? 0], { stroke : theme.mark, strokeWidth : 3, strokeDasharray : "2 3" }),
                    ];
                    return {
                        marginLeft : 52,
                        x : { type : "log", label : "Latency (ms, log scale)", tickFormat : (tick : number) => formatNumber(tick, 0) },
                        y : { label : "Samples", grid : true },
                        color : { domain : loads.map(load => load.name), range : loads.map((_, index) => seriesColor(theme, index)) },
                        marks,
                    };
                }}
                table={{
                    caption : "The samples in each bucket",
                    columns : [
                        { key : "bucket", label : "Bucket" },
                        ...loads.map((load, index) => ({ key : `b${index}`, label : load.name, align : "right" as const })),
                    ],
                    rows : result.buckets.map(bucket => ({
                        bucket : Number.isFinite(bucket.upper) ? `${formatMs(bucket.lower)} to ${formatMs(bucket.upper)}` : `Above ${formatMs(bucket.lower)}`,
                        ...Object.fromEntries(bucket.counts.map((count, index) => [`b${index}`, count])),
                    })),
                }}
            />

            <dl className={explainerStyles.stats}>
                <div>
                    <dt><RuleSwatch color={colors.ink} />p95 of all samples</dt>
                    <dd>{formatMs(pooled)}</dd>
                </div>
                <div data-tone="accent">
                    <dt><RuleSwatch color={colors.accent} dash="6 4" />From the merged buckets</dt>
                    <dd>{formatMs(result.fromHistogram ?? 0)} <span className={styles.error}>{signedMs(histogramError)}</span></dd>
                </div>
                <div data-tone="mark">
                    <dt><RuleSwatch color={colors.mark} dash="2 3" width={3} />Mean of the three p95</dt>
                    <dd>{formatMs(result.meanOfPercentiles ?? 0)} <span className={styles.error}>{signedMs(meanError)}</span></dd>
                </div>
            </dl>

            <div className={explainerStyles.readout} data-tone={Math.abs(meanError) > Math.abs(histogramError) ? "mark" : undefined}>
                <p>
                    The mean of the percentiles gives each group the same weight, also a group with few samples. It is not a
                    percentile of the samples. The buckets of all browsers add together, thus the merged histogram keeps the
                    distribution. Its error is less than the width of the bucket of the rank.
                </p>
                <p className={explainerStyles.formula}>histogram_quantile(0.95, sum by (le) (rate(lag_drift_histogram_bucket[5m])))</p>
            </div>
        </Explainer>
    );
}
