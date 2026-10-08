/**
 * The idle lag of DriftLag before and after the calibration (experiments E2
 * and E3, 2026-10-07, Windows 11, the headless engines of Playwright). The
 * values are the median lag of an idle 100 ms window, in milliseconds.
 */
import type { DataTableSpec } from "../../src/components/DataTable/DataTable";
import type { PlotOptionsInput } from "../../src/components/PlotFigure/PlotFigure";
import { formatMs } from "../../src/lib/format";
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
