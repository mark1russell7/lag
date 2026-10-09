import { memo, useId, useMemo } from "react";
import type { InteractionType } from "../../adapters/lag-core";
import { PlotFigure, type Markish } from "../../components/PlotFigure/PlotFigure";
import { formatMs } from "../../lib/format";
import { ChartLegend } from "../../results/components/ChartLegend";
import { seriesColor, useThemeColors, type ThemeColors } from "../../theme/colors";
import { interactionScatter, summarizeScatter, type ScatterPoint } from "./inp-scatter";
import type { InpThresholds, TimelineModel } from "./model";
import styles from "./Analysis.module.css";

const TYPES : readonly InteractionType[] = ["pointer", "keyboard", "other"];

const TYPE_LABELS : Readonly<Record<InteractionType, string>> = {
    pointer : "Pointer (click, tap)",
    keyboard : "Keyboard",
    other : "Other",
};

/** The colors of the interaction types, in a fixed order. Pointer has the color of the interactions on the timeline. */
export function typeColors(theme : ThemeColors) : Readonly<Record<InteractionType, string>> {
    return { pointer : seriesColor(theme, 6), keyboard : seriesColor(theme, 3), other : seriesColor(theme, 5) };
}

const RATING_TEXT = { "good" : "good", "needs-improvement" : "needs improvement", "poor" : "poor" } as const;

/** The ticks of the log scales: 1, 2 and 5 multiplied by the powers of 10. */
const LOG_TICKS = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000];

/** The smallest duration that the Event Timing monitor reports. */
const MIN_DURATION_MS = 16;

/** The points of the line where the duration is equal to the blocking time, for a log scale. */
function diagonalPoints(to : number) : Array<{ v : number }> {
    const points : Array<{ v : number }> = [];
    for (let value = MIN_DURATION_MS; value < to; value *= 1.25) points.push({ v : value });
    points.push({ v : to });
    return points;
}

function pointTitle(point : ScatterPoint) : string {
    return [
        `${point.names.join(", ")} at ${point.t.toFixed(2)} s`,
        `Duration: ${formatMs(point.durationMs)} (${RATING_TEXT[point.rating]} as INP)`,
        point.frames > 0
            ? `Blocking of ${point.frames} overlapping ${point.frames === 1 ? "frame" : "frames"}: ${formatMs(point.blockingMs)}`
            : "No long animation frame overlaps it",
    ].join("\n");
}

type ScatterChartProps = {
    points : readonly ScatterPoint[];
    thresholds : InpThresholds;
    description : string;
    /** Only for the comparison of the props. */
    dataKey : string;
};

const ScatterChart = memo(function ScatterChart({ points, thresholds, description } : ScatterChartProps) {
    const { good, poor } = thresholds;
    return (
        <PlotFigure
            title="Interaction duration and the blocking time of overlapping frames"
            hideTitle
            description={description}
            height={340}
            options={({ Plot, theme, width }) => {
                const colors = typeColors(theme);
                // On a narrow chart, only the powers of 10 have ticks, so that the labels do not touch
                const narrow = width < 520;
                const ticksOf = (from : number, to : number) : number[] => LOG_TICKS.filter(tick => tick >= from && tick <= to && (!narrow || Number.isInteger(Math.log10(tick))));
                // Log scales: the thresholds and a hang of some seconds fit in one chart. The x scale is symlog, because 0 ms is a value.
                const maxBlocking = Math.max(500, ...points.map(point => point.blockingMs)) * 1.3;
                const maxDuration = Math.max(poor * 2, ...points.map(point => point.durationMs * 1.3));
                const diagonal = Math.min(maxBlocking, maxDuration);
                const yTicks = ticksOf(MIN_DURATION_MS, maxDuration);
                const tickText = (tick : number) : string => tick.toLocaleString("en");
                const marks : Markish[] = [
                    // Plot thins the labels of a log axis. An axis mark with its own text shows each label.
                    Plot.gridY(yTicks),
                    Plot.axisY(yTicks, { text : tickText, label : "Interaction duration (ms, log scale)" }),
                    Plot.rect([{ y1 : poor, y2 : maxDuration }], { x1 : 0, x2 : maxBlocking, y1 : "y1", y2 : "y2", fill : theme.status.critical, fillOpacity : 0.06 }),
                    Plot.ruleX([0], { stroke : theme.chartAxis }),
                    Plot.line(diagonalPoints(diagonal), { x : "v", y : "v", stroke : theme.ruleStrong, strokeDasharray : "2 4" }),
                    Plot.ruleY([good, poor], { stroke : theme.inkMuted, strokeDasharray : "5 4" }),
                    // At the right edge: there, the blocking is longer than the duration, thus few dots are there
                    Plot.text([
                        { y : good, text : `Good INP: ${good} ms or less` },
                        { y : poor, text : `Poor INP: more than ${poor} ms` },
                    ], { y : "y", text : "text", frameAnchor : "right", dx : -4, dy : -8, textAnchor : "end", fill : theme.inkSecondary }),
                    Plot.dot(points, {
                        x : "blockingMs",
                        y : "durationMs",
                        fill : (point : ScatterPoint) => colors[point.type],
                        r : 5,
                        stroke : theme.surface,
                        strokeWidth : 2,
                        title : pointTitle,
                        tip : true,
                    }),
                ];
                return {
                    marginLeft : 52,
                    marginRight : 16,
                    marginBottom : 42,
                    x : {
                        type : "symlog",
                        constant : 20,
                        domain : [0, maxBlocking],
                        ticks : [0, ...ticksOf(50, maxBlocking)],
                        tickFormat : (tick : number) => tickText(tick),
                        label : "Blocking time of overlapping long frames (ms, log scale)",
                        labelAnchor : "center",
                        labelOffset : 36,
                        grid : true,
                    },
                    y : { type : "log", domain : [MIN_DURATION_MS, maxDuration] },
                    marks,
                };
            }}
            table={{
                caption : "Each interaction",
                columns : [
                    { key : "t", label : "Start (s)", align : "right", format : value => (value as number).toFixed(2) },
                    { key : "names", label : "Events", format : value => (value as readonly string[]).join(", ") },
                    { key : "type", label : "Type" },
                    { key : "durationMs", label : "Duration", align : "right", format : value => formatMs(value as number) },
                    { key : "blockingMs", label : "Blocking of overlapping frames", align : "right", format : value => formatMs(value as number) },
                    { key : "frames", label : "Frames", align : "right" },
                ],
                rows : points,
            }}
        />
    );
}, (previous, next) => previous.dataKey === next.dataKey && previous.description === next.description);

/**
 * The duration of each interaction against the blocking time of the long
 * animation frames that overlap it, with the INP thresholds as guides.
 */
export function InpScatterPanel({ model } : { model : TimelineModel }) {
    const headingId = useId();
    const theme = useThemeColors();
    const colors = typeColors(theme);
    const points = useMemo(() => interactionScatter(model), [model]);
    const summary = summarizeScatter(points);
    const { good, poor } = model.inpThresholds;
    const inp = model.vitals.find(vital => vital.name === "INP");
    const typesInData = TYPES.filter(type => points.some(point => point.type === type));
    const dataKey = points.map(point => `${point.id}:${point.durationMs}:${point.blockingMs}`).join(",");

    const summaryText = summary.count === 0
        ? "No interactions yet."
        : `${summary.count} ${summary.count === 1 ? "interaction" : "interactions"}. ${summary.withFrames} overlap a long animation frame. ${summary.slow} took more than ${good} ms, and ${summary.slowWithFrames} of them overlap a long frame.`;

    return (
        <section className={styles.panel} aria-labelledby={headingId}>
            <h3 id={headingId} className={styles.heading}>Interactions and long animation frames</h3>
            <p className={styles.lead}>
                Each dot is one interaction. The x axis gives the blocking time of the long animation frames that overlap the
                interaction. The y axis gives its duration, as INP measures it. A dot above {poor} ms is a poor interaction. Both
                axes have a log scale.
            </p>
            <p className={styles.count} role="status">
                {summaryText}
                {inp ? ` The INP of this page view is ${formatMs(inp.value)}.` : ""}
            </p>
            {!model.support.eventTiming && model.running ? (
                <p className={styles.empty}>This browser does not report Event Timing entries. Thus the chart stays empty.</p>
            ) : null}
            {model.support.eventTiming && !model.support.longAnimationFrame ? (
                <p className={styles.empty}>This browser does not report long animation frames. Thus all dots are at 0 ms on the x axis.</p>
            ) : null}
            <ChartLegend
                items={[
                    ...typesInData.map(type => ({ label : TYPE_LABELS[type], color : colors[type] })),
                    { label : "Duration equal to the blocking time", color : theme.ruleStrong, shape : "line" as const, dash : "2 4" },
                ]}
                label="Marks of the chart"
            />
            <ScatterChart
                points={points}
                thresholds={model.inpThresholds}
                description={`A scatter plot. ${summaryText} The guides are the INP thresholds of ${good} ms and ${poor} ms, and the line where the duration is equal to the blocking time.`}
                dataKey={dataKey}
            />
            {summary.count === 0 && model.support.eventTiming ? (
                <p className={styles.empty}>Select a load button. Each click is an interaction, and a blocked click makes a long one.</p>
            ) : null}
        </section>
    );
}
