import { useId, useMemo, useRef, useState } from "react";
import { DataTableDisclosure } from "../../components/DataTable/DataTable";
import { formatMs, formatNumber } from "../../lib/format";
import { useElementWidth } from "../../lib/use-element-width";
import { useThemeColors } from "../../theme/colors";
import { Explainer, explainerStyles as styles } from "../Explainer";
import { simulateDrift, type DriftResult, type DriftWindow } from "./drift-model";

/** The idle duration of one 5 ms step on some systems, from the experiments E2 and E3 and the WebKit source. */
const SYSTEMS = [
    { id : "chromium", label : "Chromium, Windows: 5.7 ms", granularityMs : 5.7, jitterMs : 0.4 },
    { id : "windows-tick", label : "Firefox or WebKit, Windows: 15.6 ms", granularityMs : 15.6, jitterMs : 0.8 },
    { id : "low-power", label : "Safari, Low Power Mode: 30 ms", granularityMs : 30, jitterMs : 0.5 },
] as const;

type SystemId = (typeof SYSTEMS)[number]["id"];

const WINDOWS = 3;
const HEIGHT = 196;
const MARGIN = { left : 8, right : 8 };
const ROWS = { stepsLabel : 14, steps : 32, blockLabel : 62, block : 70, windows : 112, axis : 168 } as const;

function signedMs(ms : number) : string {
    return ms < 0 ? `−${formatMs(-ms)}` : formatMs(ms);
}

/** A duration with one decimal, so that the numbers of a formula agree. */
function ms1(ms : number) : string {
    return `${ms < 0 ? "−" : ""}${formatNumber(Math.abs(ms), 1)} ms`;
}

function Drawing({ result, block, width } : { result : DriftResult; block : { start : number; duration : number }; width : number }) {
    const colors = useThemeColors();
    const patternId = useId();
    const innerWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
    const end = Math.max(result.end, block.start + block.duration);
    const x = (time : number) : number => MARGIN.left + (time / end) * innerWidth;
    const ticks : number[] = [];
    // The labels of the ticks need approximately 56 px each
    const tickStep = [50, 100, 200, 500].find(step => (step / end) * innerWidth >= 56) ?? 1_000;
    for (let tick = 0; tick <= end; tick += tickStep) ticks.push(tick);
    const blockWidth = x(block.start + block.duration) - x(block.start);

    return (
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} aria-hidden="true" focusable="false">
            <defs>
                <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={colors.surface} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke={colors.mark} strokeWidth="2" />
                </pattern>
            </defs>

            <text x={MARGIN.left} y={ROWS.stepsLabel} fill={colors.inkSecondary} fontSize="12">
                Timer steps ({result.steps.length}), one tick at each callback
            </text>
            {result.steps.map((step, index) => (
                <g key={index}>
                    <line
                        x1={x(step.start)} x2={x(step.end)} y1={ROWS.steps} y2={ROWS.steps}
                        stroke={step.delayed ? colors.mark : colors.series[0]}
                        strokeWidth={step.delayed ? 4 : 2}
                    />
                    <line x1={x(step.end)} x2={x(step.end)} y1={ROWS.steps - 7} y2={ROWS.steps + 7} stroke={step.delayed ? colors.mark : colors.ink} strokeWidth={1.5} />
                </g>
            ))}

            <text x={MARGIN.left} y={ROWS.blockLabel} fill={colors.inkSecondary} fontSize="12">
                {block.duration > 0 ? `A long task blocks the main thread for ${formatMs(block.duration)}` : "No long task"}
            </text>
            {block.duration > 0 ? (
                <rect x={x(block.start)} y={ROWS.block} width={Math.max(1, blockWidth)} height={18} fill={`url(#${patternId})`} stroke={colors.mark} strokeWidth={1} />
            ) : null}

            {result.windows.map(window => (
                <WindowBracket
                    key={window.index} window={window} x={x} lagged={window.lagMs >= result.baselineMs}
                    colors={{ ink : colors.ink, rule : colors.ruleStrong, wash : colors.surfaceSunken, mark : colors.mark }}
                />
            ))}

            <line x1={MARGIN.left} x2={MARGIN.left + innerWidth} y1={ROWS.axis} y2={ROWS.axis} stroke={colors.chartAxis} />
            {ticks.map(tick => (
                <g key={tick}>
                    <line x1={x(tick)} x2={x(tick)} y1={ROWS.axis} y2={ROWS.axis + 4} stroke={colors.chartAxis} />
                    <text x={x(tick)} y={ROWS.axis + 17} textAnchor={tick === 0 ? "start" : "middle"} fill={colors.inkMuted} fontSize="11">{tick} ms</text>
                </g>
            ))}
        </svg>
    );
}

/** One window. A window with more lag than one step shows in red: jitter cannot give that lag. */
function WindowBracket({ window, x, lagged, colors } : {
    window : DriftWindow;
    x : (time : number) => number;
    lagged : boolean;
    colors : { ink : string; rule : string; wash : string; mark : string };
}) {
    const left = x(window.start);
    const right = x(window.end);
    const label = `W${window.index + 1}: ${signedMs(window.lagMs)}`;
    return (
        <g>
            <rect x={left} y={ROWS.windows - 14} width={Math.max(1, right - left)} height={34} fill={window.index % 2 === 0 ? colors.wash : "none"} />
            <path d={`M${left + 1},${ROWS.windows - 14} v34 M${right - 1},${ROWS.windows - 14} v34`} stroke={colors.rule} />
            {right - left > 64 ? (
                <text x={(left + right) / 2} y={ROWS.windows + 7} textAnchor="middle" fontSize="12" fontWeight={lagged ? 700 : 400} fill={lagged ? colors.mark : colors.ink}>
                    {label}
                </text>
            ) : null}
        </g>
    );
}

/**
 * The DriftLag stepper: the reader moves a long task over the timer steps of
 * three windows, and sees the lag that each window reports.
 */
export default function DriftStepper() {
    const [systemId, setSystemId] = useState<SystemId>("windows-tick");
    const [blockStart, setBlockStart] = useState(130);
    const [blockDuration, setBlockDuration] = useState(120);
    const [calibrated, setCalibrated] = useState(true);
    const drawingRef = useRef<HTMLDivElement>(null);
    const width = useElementWidth(drawingRef) || 640;
    const ids = { system : useId(), start : useId(), duration : useId() };

    const system = SYSTEMS.find(candidate => candidate.id === systemId) ?? SYSTEMS[0];
    const block = useMemo(() => ({ start : blockStart, duration : blockDuration }), [blockStart, blockDuration]);
    const result = useMemo(() => simulateDrift({
        granularityMs : system.granularityMs,
        jitterMs : system.jitterMs,
        stepMs : 5,
        windowMs : 100,
        windows : WINDOWS,
        block,
        calibrated,
    }), [system, block, calibrated]);

    const worst = result.windows.reduce((a, b) => (b.lagMs > a.lagMs ? b : a));
    // The parts of the formula, rounded first, so that the numbers of the formula agree
    const round1 = (value : number) : number => Math.round(value * 10) / 10;
    const formula = { duration : round1(worst.end - worst.start), idle : round1(worst.idleMs) };
    const totalLag = result.windows.reduce((sum, window) => sum + window.lagMs, 0);
    const blocked = result.windows.reduce((sum, window) => sum + window.blockedMs, 0);
    const missed = blocked - totalLag;

    return (
        <Explainer
            title="Move a long task over the timer steps of DriftLag"
            caption={
                <>
                    A simplified model of the monitor: three windows of chained 5 ms timeouts, with steps of the selected length.
                    The monitor also has a warm-up, probes and a change of the granularity. The step lengths come from the
                    experiments E2 and E3 on Windows 11 and from the WebKit source.
                </>
            }
        >
            <fieldset className={styles.controls}>
                <legend className="visually-hidden">The scenario</legend>
                <label className={styles.field} htmlFor={ids.system}>
                    <span className={styles.fieldLabel}>Browser and system: the length of one idle step</span>
                    <select id={ids.system} className="control" value={systemId} onChange={event => setSystemId(event.target.value as SystemId)}>
                        {SYSTEMS.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                    </select>
                </label>
                <label className={styles.field} htmlFor={ids.start}>
                    <span className={styles.fieldLabel}>Start of the long task <span className={styles.fieldValue}>{blockStart} ms</span></span>
                    <input id={ids.start} type="range" min={0} max={250} step={1} value={blockStart} onChange={event => setBlockStart(Number(event.target.value))} />
                </label>
                <label className={styles.field} htmlFor={ids.duration}>
                    <span className={styles.fieldLabel}>Duration of the long task <span className={styles.fieldValue}>{blockDuration} ms</span></span>
                    <input id={ids.duration} type="range" min={0} max={250} step={5} value={blockDuration} onChange={event => setBlockDuration(Number(event.target.value))} />
                </label>
                <label className={styles.check}>
                    <input type="checkbox" checked={calibrated} onChange={event => setCalibrated(event.target.checked)} />
                    Subtract the calibrated baseline
                </label>
            </fieldset>

            <div ref={drawingRef} className={styles.drawing} role="img" aria-label={
                `${result.steps.length} timer steps in ${WINDOWS} windows. The long task from ${blockStart} ms to ${blockStart + blockDuration} ms delays `
                + `${result.steps.filter(step => step.delayed).length} step. The windows report ${result.windows.map(window => signedMs(window.lagMs)).join(", ")} of lag.`
            }>
                <Drawing result={result} block={block} width={width} />
            </div>

            <div className={styles.readout} data-tone={calibrated ? undefined : "mark"}>
                <p className={styles.formula}>
                    Window {worst.index + 1}: {ms1(formula.duration)} − {ms1(formula.idle)} ({worst.steps} steps × {formatNumber(result.baselineMs, 2)} ms) = {ms1(formula.duration - formula.idle)}
                </p>
                {calibrated ? (
                    <p>
                        The windows report {signedMs(totalLag)} of lag, and the long task blocked {formatMs(blocked)} of them.
                        {blockDuration > 0 ? ` The difference, ${formatMs(Math.max(0, missed))}, is the time from the start of the task to the next timer. It is less than one step.` : " An idle window has a lag near 0 ms."}
                    </p>
                ) : (
                    <p>
                        Without calibration, the monitor subtracts the requested 5 ms for each step. Each step takes {formatMs(system.granularityMs)},
                        thus each window gets false lag, also without a long task.
                    </p>
                )}
            </div>

            <dl className={styles.stats}>
                <div><dt>Steps in each window</dt><dd>{result.stepsPerWindow}</dd></div>
                <div><dt>Baseline step</dt><dd>{formatNumber(result.baselineMs, 2)} ms</dd></div>
                <div data-tone="mark"><dt>Lag of all windows</dt><dd>{signedMs(totalLag)}</dd></div>
                <div><dt>Blocked time</dt><dd>{formatMs(blocked)}</dd></div>
            </dl>

            <div className={styles.tableBlock}>
                <DataTableDisclosure
                    title="DriftLag windows"
                    spec={{
                        caption : "Each window of the model",
                        columns : [
                            { key : "window", label : "Window", align : "right" },
                            { key : "steps", label : "Steps", align : "right" },
                            { key : "duration", label : "Duration", align : "right", format : value => formatMs(value as number) },
                            { key : "idle", label : "Idle duration", align : "right", format : value => formatMs(value as number) },
                            { key : "lag", label : "Lag", align : "right", format : value => signedMs(value as number) },
                            { key : "blocked", label : "Blocked time", align : "right", format : value => formatMs(value as number) },
                        ],
                        rows : result.windows.map(window => ({
                            window : window.index + 1,
                            steps : window.steps,
                            duration : window.end - window.start,
                            idle : window.idleMs,
                            lag : window.lagMs,
                            blocked : window.blockedMs,
                        })),
                    }}
                />
            </div>
        </Explainer>
    );
}
