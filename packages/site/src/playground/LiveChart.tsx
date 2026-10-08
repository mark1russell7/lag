import { PlotFigure, type Markish } from "../components/PlotFigure/PlotFigure";
import { formatMs } from "../lib/format";
import { seriesColor } from "../theme/colors";
import type { LiveSeries } from "./session";
import styles from "./LiveChart.module.css";

export type LiveChartProps = {
    title : string;
    /** What the chart shows. It is the text alternative of the chart. */
    description : string;
    series : LiveSeries;
    windowSeconds : number;
    elapsedSeconds : number;
    /** "line" for regular samples, and "dot" for separate events. */
    mark : "line" | "dot";
    /** A horizontal reference line, for example one frame at 60 Hz. */
    reference? : { value : number; label : string };
    /** Shows when the window has no values. */
    emptyText : string;
};

/** One live chart of the playground, with its latest, p95 and maximum values as text. */
export function LiveChart({ title, description, series, windowSeconds, elapsedSeconds, mark, reference, emptyText } : LiveChartProps) {
    const end = Math.max(windowSeconds, elapsedSeconds);
    const lastPoints = series.points.slice(-10);
    return (
        <div className={styles.panel}>
            <PlotFigure
                title={title}
                description={description}
                height={170}
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
                    marks.push(mark === "line"
                        ? Plot.lineY(series.points, { x : "t", y : "value", stroke : seriesColor(theme, 0), strokeWidth : 2, curve : "step-after" })
                        : Plot.dot(series.points, { x : "t", y : "value", fill : seriesColor(theme, 0), r : 4.5, stroke : theme.surface, strokeWidth : 2 }));
                    return {
                        marginLeft : 48,
                        x : { domain : [end - windowSeconds, end], label : "Time (s)", ticks : 6 },
                        y : {
                            label : "ms",
                            grid : true,
                            nice : true,
                            zero : true,
                            ...(series.count === 0 ? { domain : [0, reference ? reference.value * 2 : 50] } : {}),
                        },
                        marks,
                    };
                }}
                table={{
                    caption : "The newest values",
                    columns : [
                        { key : "t", label : "Time (s)", align : "right", format : (value) => (value as number).toFixed(1) },
                        { key : "value", label : "Value", align : "right", format : (value) => formatMs(value as number) },
                    ],
                    rows : lastPoints,
                }}
            />
            <dl className={styles.stats}>
                <div><dt>Latest</dt><dd>{series.latest === undefined ? "–" : formatMs(series.latest)}</dd></div>
                <div><dt>p95</dt><dd>{series.p95 === undefined ? "–" : formatMs(series.p95)}</dd></div>
                <div><dt>Maximum</dt><dd>{series.max === undefined ? "–" : formatMs(series.max)}</dd></div>
                <div><dt>Values</dt><dd>{series.count}</dd></div>
            </dl>
            {series.count === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
        </div>
    );
}
