/**
 * The duration distribution of the "heavy" workload profile of `@lag/load`.
 * The values are samples of the real distributions, with a fixed seed. No load
 * runs: the page only draws numbers.
 */
import { sampleProfileDurations } from "../../../src/adapters/lag-load";
import type { DataTableSpec } from "../../../src/components/DataTable/DataTable";
import type { PlotOptionsInput } from "../../../src/components/PlotFigure/PlotFigure";
import { formatMs } from "../../../src/lib/format";
import { summarize } from "../../../src/lib/stats";
import { seriesColor } from "../../../src/theme/colors";

const samples = sampleProfileDurations("heavy", 400, 42);
const points = samples.flatMap(sample => sample.values.map(value => ({ spec : sample.spec, value })));

export const heavyProfileChart : PlotOptionsInput = ({ Plot, theme }) => ({
    height : 70 + samples.length * 46,
    marginLeft : 120,
    marginRight : 24,
    x : { type : "symlog", label : "Lag event duration (ms)", grid : true },
    y : { domain : samples.map(sample => sample.spec), label : null, tickSize : 0 },
    marks : [
        Plot.boxX(points, { x : "value", y : "spec", fill : seriesColor(theme, 0), fillOpacity : 0.25, stroke : theme.inkSecondary }),
    ],
});

export const heavyProfileTable : DataTableSpec = {
    caption : "Samples of each lag spec of the heavy profile (400 each, seed 42)",
    columns : [
        { key : "spec", label : "Lag spec" },
        { key : "weight", label : "Weight", align : "right" },
        { key : "p50", label : "p50", align : "right", format : (value) => formatMs(value as number) },
        { key : "p95", label : "p95", align : "right", format : (value) => formatMs(value as number) },
        { key : "max", label : "Maximum", align : "right", format : (value) => formatMs(value as number) },
    ],
    rows : samples.map(sample => {
        const summary = summarize(sample.values);
        return { spec : sample.spec, weight : sample.weight, p50 : summary.p50, p95 : summary.p95, max : summary.max };
    }),
};
