/**
 * A simulated session for the section on hang-aligned averages. The
 * playground uses the same functions (`blockEpisodes` and `epochAverages`)
 * on the data of the live session.
 */
import type { DataTableSpec } from "../../../src/components/DataTable/DataTable";
import type { Markish, PlotOptionsInput } from "../../../src/components/PlotFigure/PlotFigure";
import { formatMs } from "../../../src/lib/format";
import { blockEpisodes, epochAverages, type EpochAlignment } from "../../../src/playground/timeline/epochs";
import { EMPTY_TIMELINE, type FrameItem, type InteractionItem, type TimedValue, type TimelineModel } from "../../../src/playground/timeline/model";
import { seriesColor } from "../../../src/theme/colors";

/** The durations of the blocks, in ms. A block starts each 10 s, at 5 s, 15 s and so on. */
export const BLOCK_DURATIONS : readonly number[] = [300, 450, 800, 200, 650, 900, 350, 500, 700, 250, 600, 400];

const WINDOW = 0.1;
const SESSION = BLOCK_DURATIONS.length * 10 + 5;

/** The windows of DriftLag: each window of 100 ms that contains the start of a block gets the duration of the block as its lag. */
function simulatedDrift() : TimedValue[] {
    const points : TimedValue[] = [];
    let cursor = 0;
    for (let index = 0; cursor < SESSION; index++) {
        const blockIndex = BLOCK_DURATIONS.findIndex((_, block) => {
            const start = 5 + block * 10;
            return start >= cursor && start < cursor + WINDOW;
        });
        const lag = blockIndex >= 0 ? BLOCK_DURATIONS[blockIndex]! : 0.5 + (index * 7 % 5) * 0.3;
        cursor += WINDOW + (blockIndex >= 0 ? lag / 1000 : 0);
        points.push({ t : Math.round(cursor * 1000) / 1000, value : lag });
    }
    return points;
}

function simulatedFrames() : FrameItem[] {
    return BLOCK_DURATIONS.map((duration, index) => {
        const start = 5 + index * 10;
        return { start, end : start + (duration + 20) / 1000, durationMs : duration + 20, blockingMs : duration - 50, renderMs : 12, script : undefined };
    });
}

/** The click that starts each block. Event Timing rounds each duration to 8 ms. */
function simulatedInteractions() : InteractionItem[] {
    return BLOCK_DURATIONS.map((duration, index) => {
        const start = 5 + index * 10 - 0.01;
        const durationMs = Math.round((duration + 45) / 8) * 8;
        return {
            id : index + 1,
            start,
            end : start + durationMs / 1000,
            durationMs,
            type : "pointer",
            names : ["pointerdown", "click"],
            inputDelayMs : 4,
            processingMs : duration + 8,
            presentationMs : 33,
            rating : durationMs <= 200 ? "good" : durationMs <= 500 ? "needs-improvement" : "poor",
        };
    });
}

export const simulatedSession : TimelineModel = {
    ...EMPTY_TIMELINE,
    now : SESSION,
    running : false,
    support : { longAnimationFrame : true, eventTiming : true, layoutShift : true },
    drift : simulatedDrift(),
    frames : simulatedFrames(),
    interactions : simulatedInteractions(),
};

const episodes = blockEpisodes(simulatedSession);

const ALIGNMENTS : ReadonlyArray<{ align : EpochAlignment; label : string }> = [
    { align : "start", label : "Time 0 at the block start" },
    { align : "end", label : "Time 0 at the block end" },
];

type Row = { alignment : string; t : number; mean : number; lower : number; upper : number; n : number };

export const epochRows : readonly Row[] = ALIGNMENTS.flatMap(({ align, label }) =>
    epochAverages(simulatedSession, episodes, { align, before : 1, after : 2, bin : 0.1 }).bins
        .filter(bin => bin.drift !== undefined)
        .map(bin => ({
            alignment : label,
            t : bin.center,
            mean : bin.drift!.mean,
            lower : bin.drift!.lower ?? Number.NaN,
            upper : bin.drift!.upper ?? Number.NaN,
            n : bin.drift!.n,
        })));

/** The mean drift lag of the 12 blocks, for the two times 0, with the 95% confidence interval of the mean as a band. */
export const epochChart : PlotOptionsInput = ({ Plot, theme }) => {
    const colors = [seriesColor(theme, 0), seriesColor(theme, 1)];
    const marks : Markish[] = [
        Plot.ruleY([0], { stroke : theme.chartAxis }),
        Plot.areaY(epochRows, { x : "t", y1 : "lower", y2 : "upper", z : "alignment", fill : "alignment", fillOpacity : 0.15 }),
        Plot.lineY(epochRows, { x : "t", y : "mean", z : "alignment", stroke : "alignment", strokeWidth : 2 }),
        Plot.ruleX([0], { stroke : theme.ink, strokeWidth : 1.5 }),
        Plot.tip(epochRows, Plot.pointerX({
            x : "t",
            y : "mean",
            title : (row : Row) => `${row.alignment}\n${row.t.toFixed(2)} s: ${formatMs(row.mean)}\n95% interval: ${formatMs(row.lower)} to ${formatMs(row.upper)}`,
        })),
    ];
    return {
        height : 260,
        marginLeft : 52,
        marginBottom : 40,
        x : { domain : [-1, 2], label : "Time from the time 0 (s)", labelAnchor : "center", labelOffset : 34 },
        y : { label : "Mean drift lag (ms)", grid : true, nice : true },
        color : { domain : ALIGNMENTS.map(alignment => alignment.label), range : colors, legend : true },
        marks,
    };
};

export const epochTable : DataTableSpec = {
    caption : "The mean drift lag of each bin of 100 ms, with the 95% confidence interval of the mean",
    columns : [
        { key : "alignment", label : "Time 0" },
        { key : "t", label : "Time (s)", align : "right", format : value => (value as number).toFixed(2) },
        { key : "mean", label : "Mean", align : "right", format : value => formatMs(value as number) },
        { key : "lower", label : "Lower limit", align : "right", format : value => formatMs(value as number) },
        { key : "upper", label : "Upper limit", align : "right", format : value => formatMs(value as number) },
        { key : "n", label : "Blocks", align : "right" },
    ],
    rows : epochRows,
};
