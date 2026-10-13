import { PlotFigure, type Markish } from "../components/PlotFigure/PlotFigure";
import { formatValue } from "../lib/format";
import { seriesColor } from "../theme/colors";
import type { LiveSeries } from "./session";
import styles from "./LiveChart.module.css";

export type LivePlotProps = {
    title : string;
    /** What the chart shows. It is the text alternative of the chart. */
    description : string;
    series : LiveSeries;
    windowSeconds : number;
    elapsedSeconds : number;
    /** "line" for regular samples, "dot" for separate events, and "total" for the running total of a counter. */
    mark : "line" | "dot" | "total";
    /** A horizontal reference line, for example one frame at 60 Hz. */
    reference? : { value : number; label : string };
    /** The OpenTelemetry unit of the values, for example "ms" (the default), "1" or "By". */
    unit? : string;
    /** The height of the chart, in pixels. The default is 170. */
    height? : number;
    /** When true, the title is not visible. It stays the accessible name. */
    hideTitle? : boolean;
};

export type LiveChartProps = LivePlotProps & {
    /** Shows when the window has no values. */
    emptyText : string;
};

/** The label of the y axis for a unit. */
function unitLabel(unit : string) : string | null {
    if (unit === "1") return null;
    if (unit === "By") return "bytes";
    return unit.startsWith("{") && unit.endsWith("}") ? unit.slice(1, -1) : unit;
}

/** The chart of a live series in its time window, with the newest values as a table. */
export function LivePlot({ title, description, series, windowSeconds, elapsedSeconds, mark, reference, unit = "ms", height = 170, hideTitle } : LivePlotProps) {
    const format = (value : number) : string => formatValue(value, unit);
    const end = Math.max(windowSeconds, elapsedSeconds);
    const lastPoints = series.points.slice(-10);
    return (
        <PlotFigure
            title={title}
            description={description}
            height={height}
            {...(hideTitle ? { hideTitle } : {})}
            options={({ Plot, theme }) => {
                const marks : Markish[] = [Plot.ruleY([0], { stroke : theme.chartAxis })];
                if (reference) {
                    marks.push(
                        Plot.ruleY([reference.value], { stroke : theme.mark, strokeDasharray : "4 3" }),
                        Plot.text([reference.value], {
                            y : (value : number) => value,
                            frameAnchor : "right",
                            dy : -7,
                            text : () => reference.label,
                            fill : theme.inkSecondary,
                        }),
                    );
                }
                // A sample of a line is the value of the interval before it. A total keeps its value until the next sample.
                marks.push(mark === "dot"
                    ? Plot.dot(series.points, { x : "t", y : "value", fill : seriesColor(theme, 0), r : 4.5, stroke : theme.surface, strokeWidth : 2 })
                    : Plot.lineY(series.points, { x : "t", y : "value", stroke : seriesColor(theme, 0), strokeWidth : 2, curve : mark === "line" ? "step-before" : "step-after" }));
                return {
                    marginLeft : unit === "By" ? 64 : 48,
                    x : { domain : [end - windowSeconds, end], label : "Time (s)", ticks : 6 },
                    y : {
                        label : unitLabel(unit),
                        ...(unit === "By" ? { tickFormat : format } : {}),
                        grid : true,
                        nice : true,
                        zero : true,
                        ...(series.count === 0 ? { domain : [0, reference ? reference.value * 2 : unit === "ms" ? 50 : 1] } : {}),
                    },
                    marks,
                };
            }}
            table={{
                caption : "The newest values",
                columns : [
                    { key : "t", label : "Time (s)", align : "right", format : (value) => (value as number).toFixed(1) },
                    { key : "value", label : "Value", align : "right", format : (value) => format(value as number) },
                ],
                rows : lastPoints,
            }}
        />
    );
}

/** One live chart of the playground, with its latest, p95 and maximum values as text. */
export function LiveChart({ emptyText, ...plot } : LiveChartProps) {
    const { series } = plot;
    const format = (value : number) : string => formatValue(value, plot.unit ?? "ms");
    return (
        <div className={styles.panel}>
            <LivePlot {...plot} />
            <dl className={styles.stats}>
                <div><dt>Latest</dt><dd>{series.latest === undefined ? "–" : format(series.latest)}</dd></div>
                <div><dt>p95</dt><dd>{series.p95 === undefined ? "–" : format(series.p95)}</dd></div>
                <div><dt>Maximum</dt><dd>{series.max === undefined ? "–" : format(series.max)}</dd></div>
                <div><dt>Values</dt><dd>{series.count}</dd></div>
            </dl>
            {series.count === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
        </div>
    );
}
