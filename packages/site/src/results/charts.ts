/**
 * This module has the chart builders of the results viewer. Each builder
 * takes model data and gives a function of the chart context (width, theme,
 * Plot), for `PlotFigure`.
 *
 * The marks follow these rules. A bar is at most 24 px thick, with a 4 px
 * round data end. A line is 2 px wide, and a grid line is a hairline. Only
 * the values that matter have a label.
 */
import type { TestStatus } from "../adapters/lag-report";
import type { Markish, PlotContext, PlotOptions } from "../components/PlotFigure/PlotFigure";
import { formatMs, formatPercent, formatValue } from "../lib/format";
import { ecdf, symlogBins } from "../lib/stats";
import { seriesColor, type ThemeColors } from "../theme/colors";
import { COVERAGE_LABELS, type CoverageMetric, type CoveragePackageRow } from "./model/coverage";
import type { DurationBin } from "./model/durations";
import type { MeasurementGroup } from "./model/measurements";
import type { MutationFileRow } from "./model/mutation";
import { STATUS_ORDER } from "./model/tests";
import type { TrendRow } from "./model/trend";

export type ChartBuilder = (context : PlotContext) => PlotOptions;

const MAX_BAR = 24;

/**
 * The inset on each side of a band, so a bar is at most 24 px thick. The
 * band width is the one of a Plot band scale with the same inner and outer
 * `padding`: available × (1 − padding) / (bands + padding).
 */
export function barInset(width : number, margins : number, bands : number, padding = 0.1) : number {
    const available = Math.max(0, width - margins);
    const bandwidth = (available * (1 - padding)) / (Math.max(1, bands) + padding);
    if (bandwidth <= MAX_BAR) return 0;
    return (bandwidth - MAX_BAR) / 2;
}

export function statusColors(theme : ThemeColors) : Readonly<Record<TestStatus, string>> {
    return {
        failed : theme.status.critical,
        passed : theme.status.good,
        skipped : theme.status.neutral,
        todo : theme.status.warning,
    };
}

/** The dash patterns of the lines, in series order: the second way to tell lines apart. */
export const LINE_DASHES : readonly string[] = ["", "7 3", "2 3", "10 3 2 3", "1 3", "14 4", "5 2 1 2", "9 2"];

const runLabelFormat = new Intl.DateTimeFormat("en-GB", {
    day : "numeric",
    month : "short",
    hour : "2-digit",
    minute : "2-digit",
    timeZone : "UTC",
});

/** A short label for a run on a chart axis: "6 Oct, 09:41". */
export function runLabel(createdAt : string) : string {
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? createdAt : runLabelFormat.format(date);
}

/** Test counts for each run, stacked by status, the oldest run first. */
export function runTrendChart(rows : readonly TrendRow[]) : ChartBuilder {
    return ({ Plot, theme, width }) => {
        const runIds = [...new Set(rows.map(row => row.runId))];
        const labels = new Map<string, string>();
        for (const runId of runIds) {
            const createdAt = rows.find(row => row.runId === runId)?.createdAt ?? runId;
            const label = runLabel(createdAt);
            labels.set(runId, [...labels.values()].includes(label) ? `${label} (${runId})` : label);
        }
        const data = rows.map(row => ({ ...row, label : labels.get(row.runId) ?? row.runId }));
        const totals = runIds.map(runId => {
            const runRows = data.filter(row => row.runId === runId);
            return {
                label : labels.get(runId) ?? runId,
                total : runRows.reduce((sum, row) => sum + row.count, 0),
                failed : runRows.find(row => row.status === "failed")?.count ?? 0,
            };
        });
        const colors = statusColors(theme);
        const marginLeft = 48;
        const marginRight = 16;
        const inset = barInset(width, marginLeft + marginRight, runIds.length, 0.3);
        return {
            height : 260,
            marginLeft,
            marginRight,
            marginTop : 28,
            x : { domain : runIds.map(runId => labels.get(runId) ?? runId), label : null, tickSize : 0, padding : 0.3 },
            y : { label : "Tests", grid : true, nice : true },
            color : { domain : [...STATUS_ORDER], range : STATUS_ORDER.map(status => colors[status]) },
            marks : [
                Plot.barY(data, Plot.stackY({
                    x : "label",
                    y : "count",
                    fill : "status",
                    order : [...STATUS_ORDER],
                    insetLeft : inset,
                    insetRight : inset,
                    insetTop : 1,
                    insetBottom : 1,
                    title : (row : (typeof data)[number]) => `${row.label}: ${row.count} ${row.status}`,
                    tip : true,
                })),
                Plot.ruleY([0], { stroke : theme.chartAxis }),
                Plot.text(totals, {
                    x : "label",
                    y : "total",
                    text : (total : (typeof totals)[number]) => (total.failed === 0 ? "No failures" : `${total.failed} failed`),
                    dy : -10,
                    fill : theme.inkSecondary,
                }),
            ],
        };
    };
}

/** The number of tests in each duration bin. */
export function durationChart(bins : readonly DurationBin[]) : ChartBuilder {
    return ({ Plot, theme, width }) => {
        const marginLeft = 48;
        const marginRight = 16;
        const inset = barInset(width, marginLeft + marginRight, bins.length);
        const largest = bins.reduce<DurationBin | undefined>((best, bin) => (!best || bin.count > best.count ? bin : best), undefined);
        const rotate = bins.length > 6 && width < 720;
        return {
            height : rotate ? 280 : 250,
            marginLeft,
            marginRight,
            marginTop : 24,
            marginBottom : rotate ? 64 : 40,
            x : { domain : bins.map(bin => bin.label), label : "Duration", tickSize : 0, tickRotate : rotate ? -35 : 0, padding : 0.1 },
            y : { label : "Tests", grid : true, nice : true },
            marks : [
                Plot.barY(bins, {
                    x : "label",
                    y : "count",
                    fill : seriesColor(theme, 0),
                    insetLeft : inset,
                    insetRight : inset,
                    ry2 : 4,
                    title : (bin : DurationBin) => `${bin.label}: ${bin.count} tests`,
                    tip : true,
                }),
                Plot.ruleY([0], { stroke : theme.chartAxis }),
                Plot.text(largest ? [largest] : [], { x : "label", y : "count", text : (bin : DurationBin) => String(bin.count), dy : -9, fill : theme.inkSecondary }),
            ],
        };
    };
}

function labelMargin(labels : readonly string[], minimum = 80, maximum = 280) : number {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(minimum, Math.min(maximum, 16 + longest * 7));
}

type BarDatum = { label : string; value : number };

function horizontalPercentBars(data : readonly BarDatum[], xLabel : string) : ChartBuilder {
    return ({ Plot, theme }) => ({
        height : 44 + data.length * 32,
        marginLeft : labelMargin(data.map(datum => datum.label)),
        marginRight : 64,
        x : { domain : [0, 100], label : xLabel, grid : true },
        y : { domain : data.map(datum => datum.label), label : null, tickSize : 0, padding : 0.2 },
        marks : [
            Plot.barX(data, {
                y : "label",
                x : "value",
                fill : seriesColor(theme, 0),
                rx2 : 4,
                title : (datum : BarDatum) => `${datum.label}: ${formatPercent(datum.value)}`,
                tip : true,
            }),
            Plot.ruleX([0], { stroke : theme.chartAxis }),
            Plot.text(data, {
                y : "label",
                x : "value",
                text : (datum : BarDatum) => formatPercent(datum.value),
                dx : 6,
                textAnchor : "start",
                fill : theme.ink,
            }),
        ],
    });
}

/** One coverage metric for each package. */
export function coverageChart(rows : readonly CoveragePackageRow[], metric : CoverageMetric) : ChartBuilder {
    const data = rows
        .filter(row => row[metric] !== undefined)
        .map(row => ({ label : row.packageName, value : row[metric] ?? 0 }));
    return horizontalPercentBars(data, `${COVERAGE_LABELS[metric]} covered (%)`);
}

/** "packages/lag/src/DriftLag.ts" → "src/DriftLag.ts". */
export function shortPath(file : string) : string {
    const segments = file.split("/");
    return segments.slice(-2).join("/");
}

/** The mutation score of each file, the lowest score first. A file without a score has no bar. */
export function mutationChart(rows : readonly MutationFileRow[], limit = 20) : ChartBuilder {
    const data = rows
        .flatMap(row => (row.score === undefined ? [] : [{ label : shortPath(row.file), value : row.score }]))
        .slice(0, limit);
    return horizontalPercentBars(data, "Mutation score (%)");
}

/**
 * This function gives the ticks up to `max` in a 1-2-5 series (0, 1, 2, 5,
 * 10, 20, 50, ...). On a log(1 + x) scale, the ticks have approximately
 * equal spaces, so the labels do not touch.
 */
export function symlogTicks(max : number) : number[] {
    if (!(max > 0) || !Number.isFinite(max)) return [0];
    const ticks = [0];
    // Start at the decade of the smaller of 1 and max, so values under 1 also get ticks.
    for (let exponent = Math.floor(Math.log10(Math.min(1, max))); 10 ** exponent <= max; exponent++) {
        for (const step of [1, 2, 5]) {
            const tick = Number((step * 10 ** exponent).toPrecision(6));
            if (tick <= max) ticks.push(tick);
        }
    }
    return ticks;
}

const tickNumber = new Intl.NumberFormat("en", { maximumSignificantDigits : 3 });

/**
 * The label of a tick of `symlogTicks`. Without it, Plot takes the precision
 * of the labels from the domain. A domain of almost equal values then gives
 * labels, for example "1,000.00000000000000".
 */
export function formatTick(value : number) : string {
    return tickNumber.format(value);
}

function maxValue(groups : readonly MeasurementGroup[]) : number {
    return groups.reduce((max, group) => Math.max(max, group.summary.max ?? 0), 0);
}

/** One histogram for each group (small multiples), on a log(1 + x) scale. */
export function measurementHistogram(groups : readonly MeasurementGroup[], unit : string) : ChartBuilder {
    return ({ Plot, theme }) => {
        const names = groups.map(group => group.group);
        const bins = groups.flatMap(group => symlogBins(group.values, 28).map(bin => ({ ...bin, group : group.group })));
        type Datum = (typeof bins)[number];
        return {
            height : 48 + groups.length * 92,
            marginLeft : 48,
            marginRight : 16,
            x : { type : "symlog", label : unit, grid : true, ticks : symlogTicks(maxValue(groups)), tickFormat : formatTick },
            y : { label : "Values", ticks : 3, grid : true },
            fy : { domain : names, axis : null, padding : 0.22 },
            color : { domain : names, range : names.map((_, index) => seriesColor(theme, index)) },
            marks : [
                Plot.rectY(bins, {
                    x1 : "x0",
                    x2 : "x1",
                    y : "count",
                    fy : "group",
                    fill : "group",
                    insetLeft : 0.5,
                    insetRight : 0.5,
                    title : (bin : Datum) => `${bin.group}: ${bin.count} values from ${formatValue(bin.x0, unit)} to ${formatValue(bin.x1, unit)}`,
                    tip : true,
                }),
                Plot.ruleY([0], { stroke : theme.chartAxis }),
                Plot.text(groups, {
                    fy : "group",
                    text : (group : MeasurementGroup) => group.group,
                    frameAnchor : "top-left",
                    dx : 4,
                    dy : -2,
                    fill : theme.ink,
                    fontWeight : 700,
                }),
            ],
        };
    };
}

/** The cumulative distribution of each group, with p50, p95 and p99 guides. */
export function measurementEcdf(groups : readonly MeasurementGroup[], unit : string) : ChartBuilder {
    return ({ Plot, theme }) => {
        const curves = groups.map(group => ({ group : group.group, points : ecdf(group.values, 300) }));
        const pointer = curves.flatMap(curve => curve.points.map(point => ({ ...point, group : curve.group })));
        // p95 and p99 are close together, so their labels move apart.
        const guides : ReadonlyArray<[number, number]> = [[0.5, 0], [0.95, 6], [0.99, -6]];
        const marks : Markish[] = [
            Plot.ruleY(guides.map(([value]) => value), { stroke : theme.chartAxis, strokeOpacity : 0.6 }),
            ...guides.map(([value, dy]) => Plot.text([value], {
                y : (guide : number) => guide,
                text : (guide : number) => `p${Math.round(guide * 100)}`,
                frameAnchor : "right",
                textAnchor : "start",
                dx : 6,
                dy,
                fill : theme.inkSecondary,
            })),
            ...curves.map((curve, index) => Plot.lineY(curve.points, {
                x : "value",
                y : "fraction",
                stroke : seriesColor(theme, index),
                strokeWidth : 2,
                strokeDasharray : LINE_DASHES[index] ?? "",
                curve : "step-after",
            })),
            Plot.tip(pointer, Plot.pointer({
                x : "value",
                y : "fraction",
                title : (point : (typeof pointer)[number]) =>
                    `${point.group}\n${formatPercent(point.fraction * 100)} of values at or below ${formatValue(point.value, unit)}`,
            })),
        ];
        return {
            height : 300,
            marginLeft : 52,
            marginRight : 44,
            x : { type : "symlog", label : unit, grid : true, ticks : symlogTicks(maxValue(groups)), tickFormat : formatTick },
            y : { domain : [0, 1], label : "Fraction of values", tickFormat : "%", grid : true },
            marks,
        };
    };
}

export function formatMeasurementValue(value : number | undefined, unit : string) : string {
    if (value === undefined) return "–";
    return unit === "ms" ? formatMs(value) : formatValue(value, unit);
}
