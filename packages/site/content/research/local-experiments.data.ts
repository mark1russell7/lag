/**
 * The data of the charts of the page "Local experiments".
 *
 * - E2 and E3: the idle lag of DriftLag before and after the calibration
 *   (2026-10-07, Windows 11, the headless engines of Playwright). The values
 *   are the median lag of an idle 100 ms window, in milliseconds.
 * - E8: the cost of an async context. The values come from the results file
 *   of the runner (`local-experiments.e8.json`).
 */
import { summary as e8Summary } from "./local-experiments.e8.json";
import type { DataTableSpec } from "../../src/components/DataTable/DataTable";
import type { PlotOptionsInput } from "../../src/components/PlotFigure/PlotFigure";
import { formatMs, formatNumber } from "../../src/lib/format";
import { seriesColor } from "../../src/theme/colors";

export type IdleLagRow = {
    engine : string;
    /** The idle median lag of the old DriftLag (experiment E2). */
    beforeMs : number;
    /** The idle median lag of the calibrated DriftLag (experiment E3). */
    afterMs : number;
};

export const idleLag : readonly IdleLagRow[] = [
    { engine : "Chromium 145", beforeMs : 15.8, afterMs : 0.1 },
    { engine : "Firefox 146", beforeMs : 211, afterMs : -0.3 },
    { engine : "WebKit", beforeMs : 211, afterMs : -0.4 },
];

const BEFORE = "Before the calibration";
const AFTER = "After the calibration";

const points = idleLag.flatMap(row => [
    { engine : row.engine, phase : BEFORE, lagMs : row.beforeMs },
    { engine : row.engine, phase : AFTER, lagMs : row.afterMs },
]);

/**
 * A dumbbell chart: for each engine, one dot before and one dot after the
 * calibration, with a line between them. The labels show the values after
 * the calibration, because the axis cannot show values so near to 0.
 */
export const idleLagChart : PlotOptionsInput = ({ Plot, theme }) => ({
    height : 80 + idleLag.length * 56,
    marginLeft : 110,
    marginRight : 24,
    marginBottom : 48,
    x : { domain : [-5, 220], label : "Median lag of an idle 100 ms window (ms)", labelAnchor : "center", labelOffset : 42, grid : true },
    y : { domain : idleLag.map(row => row.engine), label : null, tickSize : 0 },
    color : { domain : [BEFORE, AFTER], range : [seriesColor(theme, 0), seriesColor(theme, 1)], legend : true },
    marks : [
        Plot.ruleX([0], { stroke : theme.chartAxis }),
        Plot.link(idleLag, { x1 : "beforeMs", x2 : "afterMs", y1 : "engine", y2 : "engine", stroke : theme.ruleStrong, strokeWidth : 2 }),
        Plot.dot(points, {
            x : "lagMs",
            y : "engine",
            fill : "phase",
            r : 5,
            stroke : theme.surface,
            strokeWidth : 2,
            title : (point : { engine : string; phase : string; lagMs : number }) => `${point.engine}, ${point.phase.toLowerCase()}: ${formatMs(point.lagMs)}`,
            tip : true,
        }),
        Plot.text(idleLag, {
            x : "afterMs",
            y : "engine",
            text : (row : IdleLagRow) => formatMs(row.afterMs),
            textAnchor : "start",
            dx : 8,
            dy : -12,
            fill : theme.inkSecondary,
        }),
    ],
});

export const idleLagTable : DataTableSpec = {
    caption : "Median lag of an idle 100 ms window, before and after the calibration of DriftLag",
    columns : [
        { key : "engine", label : "Engine" },
        { key : "beforeMs", label : "Before the calibration", align : "right", format : (value) => formatMs(value as number) },
        { key : "afterMs", label : "After the calibration", align : "right", format : (value) => formatMs(value as number) },
    ],
    rows : idleLag,
};

// --- E8: the cost of an async context ---

type E8Spread = { median : number; min : number; max : number; n : number };
type E8SetupSummary = { metrics : Record<string, E8Spread>; factorsVsA : Record<string, E8Spread> };
type E8Engine = "chromium" | "firefox" | "webkit";
type E8Setup = "A" | "B" | "C" | "D";

/** The summary of the runner: the median and the range of the rounds, for each engine and setup. */
const e8 = e8Summary as unknown as Partial<Record<E8Engine, Partial<Record<E8Setup, E8SetupSummary>>>>;

const E8_WORKLOADS = ["promise-chain", "await-loop", "async-calls", "microtasks", "timers", "events", "fetch", "operations"] as const;

/** The setups that the chart compares with setup A. */
const E8_COMPARED : ReadonlyArray<{ setup : E8Setup; label : string }> = [
    { setup : "B", label : "B. Zone.js" },
    { setup : "C", label : "C. AsyncBrowserContext" },
    { setup : "D", label : "D. stack, zone.js loaded" },
];

export type E8FactorRow = {
    workload : string;
    setup : string;
    /** The main-thread time of the workload divided by that of setup A in the same round: the median of the rounds. */
    median : number;
    min : number;
    max : number;
};

export const e8MainThreadFactors : readonly E8FactorRow[] = E8_COMPARED.flatMap(({ setup, label }) =>
    E8_WORKLOADS.flatMap((workload) => {
        const factor = e8.chromium?.[setup]?.factorsVsA[`workload.${workload}.taskMs`];
        return factor && factor.n > 0 ? [{ workload, setup : label, median : factor.median, min : factor.min, max : factor.max }] : [];
    }));

const e8Extent = (key : "min" | "max") : number => (key === "min" ? Math.min : Math.max)(...e8MainThreadFactors.map(row => row[key]));

/**
 * A dot for each workload and setup: the median factor of the rounds, with a
 * line from the lowest to the highest round. The x axis is logarithmic, and
 * the rule at 1 is the time of setup A.
 */
export const e8MainThreadChart : PlotOptionsInput = ({ Plot, theme }) => {
    const labels = E8_COMPARED.map(compared => compared.label);
    const offsets = new Map(labels.map((label, index) => [label, (index - 1) * 9]));
    return {
        height : 70 + E8_WORKLOADS.length * 34,
        marginLeft : 110,
        marginRight : 24,
        marginBottom : 48,
        x : {
            type : "log",
            domain : [Math.min(0.5, e8Extent("min") * 0.9), Math.max(2, e8Extent("max") * 1.1)],
            ticks : [0.5, 1, 2, 5, 10, 20].filter(tick => tick <= Math.max(2, e8Extent("max") * 1.1)),
            tickFormat : (tick : number) => `×${formatNumber(tick, 1)}`,
            label : "Main-thread time of the workload / main-thread time in setup A",
            labelAnchor : "center",
            labelOffset : 42,
            grid : true,
        },
        y : { domain : [...E8_WORKLOADS], label : null, tickSize : 0 },
        color : { domain : labels, range : labels.map((_, index) => seriesColor(theme, index)), legend : true },
        marks : [
            Plot.ruleX([1], { stroke : theme.chartAxis }),
            ...labels.flatMap((label) => {
                const rows = e8MainThreadFactors.filter(row => row.setup === label);
                const dy = offsets.get(label) ?? 0;
                return [
                    Plot.ruleY(rows, { y : "workload", x1 : "min", x2 : "max", stroke : "setup", strokeWidth : 2, dy }),
                    Plot.dot(rows, {
                        x : "median",
                        y : "workload",
                        fill : "setup",
                        r : 4,
                        stroke : theme.surface,
                        strokeWidth : 1.5,
                        dy,
                        title : (row : E8FactorRow) => `${row.workload}, ${row.setup}: ×${formatNumber(row.median, 2)} (rounds: ×${formatNumber(row.min, 2)} to ×${formatNumber(row.max, 2)})`,
                        tip : true,
                    }),
                ];
            }),
        ],
    };
};

export const e8MainThreadTable : DataTableSpec = {
    caption : "Main-thread time of each workload divided by the main-thread time in setup A, Chromium: the median and the range of 5 rounds",
    columns : [
        { key : "workload", label : "Workload" },
        { key : "setup", label : "Setup" },
        { key : "median", label : "Median", align : "right", format : (value) => `×${formatNumber(value as number, 2)}` },
        { key : "min", label : "Lowest round", align : "right", format : (value) => `×${formatNumber(value as number, 2)}` },
        { key : "max", label : "Highest round", align : "right", format : (value) => `×${formatNumber(value as number, 2)}` },
    ],
    rows : e8MainThreadFactors,
};
