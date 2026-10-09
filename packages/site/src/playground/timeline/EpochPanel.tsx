import { memo, useId, useMemo, useState } from "react";
import { DataTableDisclosure } from "../../components/DataTable/DataTable";
import { PlotFigure, type Markish } from "../../components/PlotFigure/PlotFigure";
import { formatMs, formatNumber } from "../../lib/format";
import { seriesColor } from "../../theme/colors";
import {
    blockEpisodes,
    DEFAULT_EPOCH_OPTIONS,
    epochAverages,
    MIN_BLOCKING_MS,
    type EpochAlignment,
    type EpochResult,
    type EpochSignal,
} from "./epochs";
import type { TimelineModel } from "./model";
import styles from "./Analysis.module.css";

type SignalSpec = {
    signal : EpochSignal;
    title : string;
    description : string;
    /** The color of the track of the timeline that shows the same signal. */
    color : "drift" | "mark" | "interaction";
    /** "line" for a signal with a value in most bins. "dot" for a sparse signal. */
    mark : "line" | "dot";
    emptyText : string;
};

const SIGNALS : readonly SignalSpec[] = [
    {
        signal : "drift",
        title : "Drift lag",
        description : "The lag that DriftLag reports in each bin of 100 ms: the sum of the lag of the windows that end in the bin. The monitor reports a block at the end of its window.",
        color : "drift",
        mark : "line",
        emptyText : "No DriftLag windows near the blocks.",
    },
    {
        signal : "blocking",
        title : "Blocking time of long animation frames",
        description : "The mean of the blocking time of the frames that start in each bin of 100 ms. A bin without a frame counts as 0 ms.",
        color : "mark",
        mark : "line",
        emptyText : "This browser does not report long animation frames.",
    },
    {
        signal : "event",
        title : "Interaction duration",
        description : "The mean duration of the interactions that start in each bin of 100 ms. Only the bins with an interaction have a value.",
        color : "interaction",
        mark : "dot",
        emptyText : "No interactions near the blocks.",
    },
];

type Row = { center : number; mean : number; lower : number; upper : number; n : number };

function rowsOf(result : EpochResult, signal : EpochSignal) : Row[] {
    return result.bins.map(bin => {
        const stat = bin[signal];
        return {
            center : bin.center,
            mean : stat?.mean ?? Number.NaN,
            lower : stat?.lower ?? Number.NaN,
            upper : stat?.upper ?? Number.NaN,
            n : stat?.n ?? 0,
        };
    });
}

/** A key that changes only when the chart changes. A new model with the same values does not draw the chart again. */
function rowsKey(rows : readonly Row[], align : EpochAlignment) : string {
    return `${align}|${rows.map(row => `${row.n}:${row.mean.toFixed(1)}:${row.lower.toFixed(1)}:${row.upper.toFixed(1)}`).join(",")}`;
}

type SignalChartProps = {
    spec : SignalSpec;
    rows : readonly Row[];
    before : number;
    after : number;
    alignLabel : string;
    /** True when the session has blocks. Without blocks, the panel tells what to do, and the chart has no note. */
    hasBlocks : boolean;
    /** Only for the comparison of the props (`rowsKey`). */
    dataKey : string;
};

const SignalChart = memo(function SignalChart({ spec, rows, before, after, alignLabel, hasBlocks } : SignalChartProps) {
    const withValues = rows.filter(row => row.n > 0);
    const peak = withValues.reduce<Row | undefined>((best, row) => (!best || row.mean > best.mean ? row : best), undefined);
    const description = `${spec.description} The time 0 is the ${alignLabel} of each block.${peak ? ` The highest mean is ${formatMs(peak.mean)}, at ${formatNumber(peak.center, 2)} s.` : ""}`;
    return (
        <div className={styles.multiple}>
            <PlotFigure
                title={spec.title}
                description={description}
                height={140}
                options={({ Plot, theme }) => {
                    const color = spec.color === "drift" ? seriesColor(theme, 0) : spec.color === "mark" ? theme.mark : seriesColor(theme, 6);
                    // The band can be very wide with 3 blocks. The scale follows the means, and the band is cut at the top.
                    const highest = Math.max(10, ...withValues.map(row => (Number.isFinite(row.upper) ? Math.min(row.upper, row.mean * 1.5 + 10) : row.mean)));
                    const marks : Markish[] = [Plot.ruleY([0], { stroke : theme.chartAxis })];
                    if (spec.mark === "line") {
                        marks.push(
                            Plot.areaY(rows, { x : "center", y1 : "lower", y2 : "upper", fill : color, fillOpacity : 0.16 }),
                            Plot.lineY(rows, { x : "center", y : "mean", stroke : color, strokeWidth : 2 }),
                        );
                    } else {
                        marks.push(
                            Plot.ruleX(withValues.filter(row => Number.isFinite(row.lower)), { x : "center", y1 : "lower", y2 : "upper", stroke : color, strokeOpacity : 0.45, strokeWidth : 3 }),
                            Plot.dot(withValues, { x : "center", y : "mean", fill : color, r : 4, stroke : theme.surface, strokeWidth : 1.5 }),
                        );
                    }
                    marks.push(
                        Plot.ruleX([0], { stroke : theme.ink, strokeWidth : 1.5 }),
                        Plot.text([0], { x : (value : number) => value, frameAnchor : "top", dx : 5, dy : 2, textAnchor : "start", text : () => alignLabel, fill : theme.inkSecondary }),
                        Plot.tip(withValues, Plot.pointerX({
                            x : "center",
                            y : "mean",
                            title : (row : Row) => [
                                `${formatNumber(row.center, 2)} s`,
                                `Mean: ${formatMs(row.mean)}`,
                                Number.isFinite(row.lower) ? `95% interval: ${formatMs(row.lower)} to ${formatMs(row.upper)}` : "No interval: fewer than 3 blocks",
                                `Blocks with a value: ${row.n}`,
                            ].join("\n"),
                        })),
                    );
                    return {
                        marginLeft : 52,
                        marginTop : 24,
                        marginBottom : 36,
                        clip : true,
                        x : { domain : [-before, after], label : `Time from the ${alignLabel} (s)`, labelAnchor : "right", labelOffset : 32, ticks : 7 },
                        y : { domain : [0, highest * 1.1], label : "ms", grid : true, nice : true, ticks : 3 },
                        marks,
                    };
                }}
            />
            {/* The note keeps its line also without text, so that the panel does not change its height */}
            <p className={styles.chartNote}>{hasBlocks && withValues.length === 0 ? spec.emptyText : "\u00A0"}</p>
        </div>
    );
}, (previous, next) => previous.dataKey === next.dataKey && previous.spec === next.spec && previous.hasBlocks === next.hasBlocks);

function statText(row : Row) : string {
    if (row.n === 0) return "–";
    return `${formatMs(row.mean)} (${row.n})`;
}

/**
 * Hang-aligned averages (a superposed epoch analysis): the drift lag, the
 * blocking time and the interaction duration around the long blocks of the
 * session, averaged over the blocks.
 */
export function EpochPanel({ model } : { model : TimelineModel }) {
    const [align, setAlign] = useState<EpochAlignment>("start");
    const baseId = useId();
    const episodes = useMemo(() => blockEpisodes(model), [model]);
    const result = useMemo(() => epochAverages(model, episodes, { ...DEFAULT_EPOCH_OPTIONS, align }), [model, episodes, align]);
    const rows = useMemo(() => SIGNALS.map(spec => rowsOf(result, spec.signal)), [result]);
    const alignLabel = align === "start" ? "block start" : "block end";
    const withFrame = episodes.filter(episode => episode.sources.includes("frame")).length;
    const withHang = episodes.filter(episode => episode.sources.includes("hang")).length;

    return (
        <section className={styles.panel} aria-labelledby={`${baseId}-heading`}>
            <h3 id={`${baseId}-heading`} className={styles.heading}>Hang-aligned averages</h3>
            <p className={styles.lead}>
                Each long block of the main thread is one epoch: a frame that blocks for {MIN_BLOCKING_MS} ms or more, a hang
                or a stall. The charts put the {alignLabel} of each block at 0 s, and they show the mean of all blocks. The band is
                the 95% confidence interval of the mean.
            </p>
            <div className={styles.controls}>
                <fieldset className={styles.segmented}>
                    <legend>Time 0</legend>
                    {(["start", "end"] as const).map(option => (
                        <label key={option}>
                            <input type="radio" name={`${baseId}-align`} value={option} checked={align === option} onChange={() => setAlign(option)} />
                            {option === "start" ? "Block start" : "Block end"}
                        </label>
                    ))}
                </fieldset>
                <p className={styles.count} role="status">
                    {episodes.length === 0
                        ? "No long blocks yet."
                        : `${episodes.length} ${episodes.length === 1 ? "block" : "blocks"}: ${withFrame} with a long frame, ${withHang} with a hang.`}
                </p>
            </div>
            <p className={styles.empty}>
                {episodes.length === 0
                    ? "Select \u201CBlock for 200 ms\u201D, \u201CBlock for 800 ms\u201D or a workload profile. Each block adds one epoch."
                    : "Each new block adds one epoch, and the averages become more certain."}
            </p>
            {/* The charts show also without blocks, thus the panel keeps its height when the first block comes */}
            <div className={styles.multiples}>
                {SIGNALS.map((spec, index) => (
                    <SignalChart
                        key={spec.signal}
                        spec={spec}
                        rows={rows[index]!}
                        before={result.options.before}
                        after={result.options.after}
                        alignLabel={alignLabel}
                        hasBlocks={episodes.length > 0}
                        dataKey={rowsKey(rows[index]!, align)}
                    />
                ))}
            </div>
            <DataTableDisclosure
                lazy
                title="Hang-aligned averages"
                spec={() => ({
                    caption : `The mean of each bin of 100 ms, and the number of blocks with a value. The time 0 is the ${alignLabel}.`,
                    columns : [
                        { key : "center", label : "Time (s)", align : "right", format : value => (value as number).toFixed(2) },
                        { key : "drift", label : "Drift lag", align : "right" },
                        { key : "blocking", label : "Blocking time", align : "right" },
                        { key : "event", label : "Interaction duration", align : "right" },
                    ],
                    rows : result.bins.map((bin, index) => ({
                        center : bin.center,
                        drift : statText(rows[0]![index]!),
                        blocking : statText(rows[1]![index]!),
                        event : statText(rows[2]![index]!),
                    })),
                })}
            />
        </section>
    );
}
