import { useCallback, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { formatMs, formatNumber } from "../../lib/format";
import { useElementWidth } from "../../lib/use-element-width";
import { RatingTag } from "../RatingTag/RatingTag";
import { FOUR_LAGS_SETTINGS, fourLags, type FourLagsResult } from "./four-lags";
import styles from "./FourLags.module.css";

/** The long task starts at this time on the axis. */
const TASK_START_MS = 150;
const DURATION = { min : 50, max : 700, step : 10, initial : 300 } as const;
const CLICK = { min : 0, max : 980, step : 5, initial : 250 } as const;

type LaneId = "main" | "drift" | "worker" | "frames" | "click";

const LANES : ReadonlyArray<{ id : LaneId; letter? : string; label : string; height : number }> = [
    { id : "main", label : "Main thread", height : 22 },
    { id : "drift", letter : "A", label : "DriftLag windows of 100 ms", height : 16 },
    { id : "worker", letter : "B", label : "Heartbeats of the worker, one each 100 ms", height : 22 },
    { id : "frames", letter : "C", label : "Rendering opportunities at 60 Hz", height : 14 },
    { id : "click", letter : "D", label : "The click: input delay, event handlers, presentation", height : 14 },
];

const AXIS_HEIGHT = 20;
const LABEL_HEIGHT = 17;
const LANE_GAP = 10;
const PAD_X = 6;
const FALLBACK_WIDTH = 640;

type LaneBox = { top : number; height : number };

function layout() : { lanes : Record<LaneId, LaneBox>; labels : Record<LaneId, number>; height : number } {
    let y = AXIS_HEIGHT;
    const lanes = {} as Record<LaneId, LaneBox>;
    const labels = {} as Record<LaneId, number>;
    for (const lane of LANES) {
        labels[lane.id] = y + 12;
        lanes[lane.id] = { top : y + LABEL_HEIGHT, height : lane.height };
        y += LABEL_HEIGHT + lane.height + LANE_GAP;
    }
    return { lanes, labels, height : y - LANE_GAP + 4 };
}

const LAYOUT = layout();

function Lanes({ result, width, hatchId, onPick } : {
    result : FourLagsResult;
    width : number;
    hatchId : string;
    onPick : (ms : number | undefined) => void;
}) {
    const axis = result.settings.axisMs;
    const plot = Math.max(1, width - 2 * PAD_X);
    const x = (ms : number) : number => PAD_X + (Math.min(axis, Math.max(0, ms)) / axis) * plot;
    const w = (from : number, to : number) : number => Math.max(0, x(to) - x(from));
    const { lanes, labels, height } = LAYOUT;
    const tickStep = width < 520 ? 200 : 100;
    const hatch = `url(#${hatchId})`;
    const svgRef = useRef<SVGSVGElement>(null);
    const dragging = useRef(false);

    const pick = (event : ReactPointerEvent<SVGSVGElement>) : void => {
        const box = svgRef.current?.getBoundingClientRect();
        if (!box || box.width === 0) return;
        const ratio = ((event.clientX - box.left) / box.width * width - PAD_X) / plot;
        onPick(Math.round(Math.min(1, Math.max(0, ratio)) * axis / CLICK.step) * CLICK.step);
    };

    const main = lanes.main;
    const drift = lanes.drift;
    const worker = lanes.worker;
    const frames = lanes.frames;
    const click = lanes.click;
    const waiting = result.heartbeats.filter(beat => beat.waitMs > 0);
    const handler = result.busy.find(period => period.kind === "handler");

    return (
        <svg
            ref={svgRef}
            className={styles.svg}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`A time axis of ${axis} ms. A long task blocks the main thread from ${Math.round(result.task.start)} to ${Math.round(result.task.end)} ms. The four lanes below show what each monitor sees.`}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragging.current = true;
                // The capture keeps the drag when the pointer leaves the figure. A pointer that the browser does not know cannot get it.
                try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                    // The drag continues without the capture
                }
                pick(event);
            }}
            onPointerMove={(event) => { if (dragging.current) pick(event); }}
            onPointerUp={() => { dragging.current = false; }}
            onPointerCancel={() => { dragging.current = false; }}
        >
            <defs>
                <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" className={styles.hatchBack} />
                    <line x1="0" y1="0" x2="0" y2="6" className={styles.hatchLine} />
                </pattern>
            </defs>

            {/* The time axis */}
            {Array.from({ length : Math.floor(axis / tickStep) + 1 }, (_, index) => index * tickStep).map(ms => (
                <g key={ms}>
                    <line x1={x(ms)} x2={x(ms)} y1={AXIS_HEIGHT - 4} y2={height} className={styles.grid} />
                    <text x={x(ms)} y={12} className={styles.tick} textAnchor={ms === 0 ? "start" : ms === axis ? "end" : "middle"}>
                        {ms === 0 ? "0 ms" : `${ms}`}
                    </text>
                </g>
            ))}

            {/* Main thread: the long task and the handlers of the click */}
            <rect x={x(0)} y={main.top} width={w(0, axis)} height={main.height} className={styles.track} />
            <rect x={x(result.task.start)} y={main.top} width={w(result.task.start, result.task.end)} height={main.height} fill={hatch} className={styles.task} />
            {w(result.task.start, result.task.end) > 120 ? (
                <text x={x(result.task.start) + 6} y={main.top + main.height / 2 + 4} className={styles.inBar}>
                    Long task, {formatMs(result.task.end - result.task.start)}
                </text>
            ) : null}
            {handler ? <rect x={x(handler.start)} y={main.top} width={Math.max(2, w(handler.start, handler.end))} height={main.height} className={styles.handler} /> : null}

            {/* A: the DriftLag windows. The hatched part of a window is its lag. */}
            {result.windows.map(window => (
                <g key={window.start}>
                    <rect x={x(window.start)} y={drift.top} width={w(window.start, window.end)} height={drift.height} className={styles.window} />
                    {window.lagMs > 0.5 ? (
                        <rect x={x(window.end - window.lagMs)} y={drift.top} width={w(window.end - window.lagMs, window.end)} height={drift.height} fill={hatch} className={styles.lag} />
                    ) : null}
                </g>
            ))}

            {/* B: the heartbeats. A red line is the wait of a heartbeat in the task queue. */}
            <line x1={x(0)} x2={x(axis)} y1={worker.top + worker.height / 2} y2={worker.top + worker.height / 2} className={styles.baseline} />
            {result.heartbeats.map((beat) => {
                const row = beat.waitMs > 0 ? waiting.indexOf(beat) % 3 : 1;
                const y = worker.top + 4 + row * ((worker.height - 8) / 2);
                return (
                    <g key={beat.sent}>
                        {beat.waitMs > 0 ? (
                            <>
                                <line x1={x(beat.sent)} x2={x(beat.processed)} y1={y} y2={y} className={styles.wait} />
                                <line x1={x(beat.processed)} x2={x(beat.processed)} y1={y - 4} y2={y + 4} className={styles.wait} />
                            </>
                        ) : null}
                        <circle cx={x(beat.sent)} cy={y} r={3.5} className={beat.waitMs > 0 ? styles.beatLate : styles.beat} />
                    </g>
                );
            })}

            {/* C: the rendering opportunities. A hollow mark is a dropped frame. */}
            {result.frames.map(slot => (
                <rect
                    key={slot.time}
                    x={x(slot.time) - 1}
                    y={frames.top}
                    width={2}
                    height={frames.height}
                    className={slot.presented ? styles.frame : styles.dropped}
                />
            ))}

            {/* D: the click and its three phases */}
            {result.click ? (
                <g>
                    <rect x={x(result.click.time)} y={click.top} width={w(result.click.time, result.click.handlerStart)} height={click.height} fill={hatch} className={styles.lag} />
                    <rect x={x(result.click.handlerStart)} y={click.top} width={Math.max(2, w(result.click.handlerStart, result.click.handlerEnd))} height={click.height} className={styles.handler} />
                    <rect x={x(result.click.handlerEnd)} y={click.top} width={w(result.click.handlerEnd, result.click.paint)} height={click.height} className={styles.presentation} />
                    <text
                        x={x(result.click.paint) + (x(result.click.paint) > width - 70 ? -4 : 4)}
                        y={click.top + click.height - 3}
                        className={styles.value}
                        textAnchor={x(result.click.paint) > width - 70 ? "end" : "start"}
                    >
                        {formatMs(result.click.durationMs)}
                    </text>
                    <line x1={x(result.click.time)} x2={x(result.click.time)} y1={main.top - 6} y2={click.top + click.height} className={styles.guide} />
                    <path d={`M ${x(result.click.time) - 5} ${main.top - 9} h 10 l -5 7 z`} className={styles.pointer} />
                </g>
            ) : (
                <text x={PAD_X} y={click.top + click.height - 3} className={styles.muted}>Nobody clicks.</text>
            )}

            {/* The labels last: they stay over the guide line of the click */}
            {LANES.map(lane => (
                <text key={lane.id} x={PAD_X} y={labels[lane.id]} className={styles.laneLabel}>
                    {lane.letter ? <tspan className={styles.laneLetter}>{lane.letter}  </tspan> : null}
                    {lane.label}
                </text>
            ))}
        </svg>
    );
}

function Readout({ letter, term, value, children, to, link } : {
    letter : string;
    term : string;
    value : string;
    children : ReactNode;
    to : string;
    link : string;
}) {
    return (
        <div className={styles.readout}>
            <dt className={styles.term}><span className={styles.letter} aria-hidden="true">{letter}</span> {term}</dt>
            <dd className={styles.value}>{value}</dd>
            <dd className={styles.detail}>{children} <Link to={to}>{link}</Link></dd>
        </div>
    );
}

/**
 * An interactive figure: one long task on a time axis, and the four
 * quantities that the monitors measure. The reader sets the length of the
 * task and the time of a click. The figure is a simulation. It makes no
 * load and starts no monitor.
 */
export function FourLags() {
    const [durationMs, setDurationMs] = useState<number>(DURATION.initial);
    const [clickMs, setClickMs] = useState<number>(CLICK.initial);
    const [clicked, setClicked] = useState(true);
    const id = useId();
    const hatchId = `${id.replace(/[^a-zA-Z0-9_-]/g, "")}-hatch`;
    const boxRef = useRef<HTMLDivElement>(null);
    const measured = useElementWidth(boxRef);
    const width = measured > 0 ? measured : FALLBACK_WIDTH;

    const result = useMemo(
        () => fourLags({ taskStartMs : TASK_START_MS, taskDurationMs : durationMs, clickMs : clicked ? clickMs : undefined }),
        [durationMs, clickMs, clicked],
    );
    const onPick = useCallback((ms : number | undefined) => {
        if (ms === undefined) return;
        setClicked(true);
        setClickMs(Math.min(CLICK.max, ms));
    }, []);

    const durationId = `${id}-duration`;
    const clickId = `${id}-click`;
    const frameInterval = FOUR_LAGS_SETTINGS.frameIntervalMs;

    return (
        <figure className={styles.figure}>
            <div className={styles.controls}>
                <div className={styles.control}>
                    <label htmlFor={durationId}>Length of the long task</label>
                    <input
                        id={durationId}
                        type="range"
                        min={DURATION.min}
                        max={DURATION.max}
                        step={DURATION.step}
                        value={durationMs}
                        onChange={(event) => setDurationMs(Number(event.target.value))}
                    />
                    <output htmlFor={durationId} className={styles.output}>{formatMs(durationMs)}</output>
                </div>
                <div className={styles.control}>
                    <label htmlFor={clickId}>Time of the click</label>
                    <input
                        id={clickId}
                        type="range"
                        min={CLICK.min}
                        max={CLICK.max}
                        step={CLICK.step}
                        value={clickMs}
                        disabled={!clicked}
                        onChange={(event) => setClickMs(Number(event.target.value))}
                    />
                    <output htmlFor={clickId} className={styles.output}>{clicked ? formatMs(clickMs) : "–"}</output>
                </div>
                <label className={styles.check}>
                    <input type="checkbox" checked={clicked} onChange={(event) => setClicked(event.target.checked)} />
                    A click occurs
                </label>
            </div>

            <div ref={boxRef} className={styles.plot}>
                <Lanes result={result} width={width} hatchId={hatchId} onPick={onPick} />
            </div>

            <dl className={styles.readouts}>
                <Readout letter="A" term="Blocked time in a window" value={formatMs(result.blockedMs)} to="/docs/monitors/drift-lag" link="DriftLag">
                    The lag of {result.lateWindows === 1 ? "one window" : `${result.lateWindows} windows`}: each window takes longer than 100 ms by the time that tasks blocked it.
                </Readout>
                <Readout letter="B" term="Queueing delay" value={formatMs(result.longestWaitMs)} to="/docs/monitors/worker-lag" link="Worker lag">
                    The longest wait of a heartbeat. {result.waitingHeartbeats} of {result.heartbeats.length} heartbeats waited. A message at a
                    random time waits {formatMs(result.meanWaitMs)} on average.
                </Readout>
                <Readout letter="C" term="Frame delay" value={formatMs(result.frameGap.ms)} to="/docs/monitors/frame-timing" link="Frame timing">
                    The longest time between two frames. It drops round({formatMs(result.frameGap.ms)} / {formatNumber(frameInterval)} ms) − 1 ={" "}
                    {result.frameGap.dropped} frames.
                </Readout>
                <Readout
                    letter="D"
                    term="Input latency"
                    value={result.click ? formatMs(result.click.durationMs) : "None"}
                    to="/docs/monitors/event-timing"
                    link="Event timing"
                >
                    {result.click ? (
                        <>
                            Input delay {formatMs(result.click.inputDelayMs)}, event handlers {formatMs(result.click.processingMs)},
                            presentation {formatMs(result.click.presentationMs)}. <RatingTag rating={result.click.rating} prefix="INP:" />.
                        </>
                    ) : (
                        <>Nobody clicks, thus the page has no input latency. The other three values do not change.</>
                    )}
                </Readout>
            </dl>

            <figcaption className={styles.caption}>
                Move the sliders, or drag on the figure to move the click. The figure is a simulation of an ideal main thread at
                60 Hz, with DriftLag steps of 5 ms. It makes no load. The four values come from one long task, but each value
                answers a different question.
            </figcaption>
        </figure>
    );
}

export default FourLags;
