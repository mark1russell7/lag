import { useId, useMemo, useRef, useState } from "react";
import { DataTable } from "../../components/DataTable/DataTable";
import { formatMs, formatNumber, formatPercent } from "../../lib/format";
import { useElementWidth } from "../../lib/use-element-width";
import { useThemeColors } from "../../theme/colors";
import { Explainer, explainerStyles as styles } from "../Explainer";
import { closedLoopSamples, openLoopSamples, randomEventDelay, statisticsOf, type ProbeSample, type ProbeScenario, type ProbeStatistics } from "./probe-model";

const PERIOD_MS = 60_000;
const ROW_HEIGHT = 84;
const LABEL_HEIGHT = 18;
const AXIS_HEIGHT = 26;
const MARGIN = { left : 8, right : 8 };
const HEARTBEATS = [250, 500, 1_000, 2_000] as const;

type Row = { label : string; samples : readonly ProbeSample[]; color : string; dots : boolean };

function Drawing({ rows, block, width, maxValue } : { rows : readonly Row[]; block : { start : number; duration : number }; width : number; maxValue : number }) {
    const colors = useThemeColors();
    const hatch = useId();
    const innerWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
    const x = (time : number) : number => MARGIN.left + (Math.min(time, PERIOD_MS) / PERIOD_MS) * innerWidth;
    const rowTop = (index : number) : number => index * (ROW_HEIGHT + LABEL_HEIGHT);
    const height = rows.length * (ROW_HEIGHT + LABEL_HEIGHT) + AXIS_HEIGHT;
    const blockEnd = Math.min(PERIOD_MS, block.start + block.duration);
    const ticks = [0, 10, 20, 30, 40, 50, 60];

    return (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" focusable="false">
            <defs>
                <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke={colors.mark} strokeWidth="1.5" strokeOpacity="0.35" />
                </pattern>
            </defs>
            {block.duration > 0 ? (
                <rect x={x(block.start)} y={LABEL_HEIGHT - 4} width={Math.max(1, x(blockEnd) - x(block.start))} height={height - AXIS_HEIGHT - LABEL_HEIGHT + 4} fill={`url(#${hatch})`} />
            ) : null}
            {rows.map((row, index) => {
                const top = rowTop(index);
                const base = top + LABEL_HEIGHT + ROW_HEIGHT;
                const y = (value : number) : number => base - (value / maxValue) * (ROW_HEIGHT - 6);
                return (
                    <g key={row.label}>
                        <text x={MARGIN.left} y={top + 12} fontSize="12" fill={colors.inkSecondary}>{row.label}</text>
                        <line x1={MARGIN.left} x2={MARGIN.left + innerWidth} y1={base} y2={base} stroke={colors.chartAxis} />
                        {row.samples.map((sample, sampleIndex) => (
                            sample.value > 0 ? (
                                <g key={sampleIndex}>
                                    <line x1={x(sample.time)} x2={x(sample.time)} y1={base} y2={y(sample.value)} stroke={row.color} strokeWidth={2} />
                                    {row.dots ? <circle cx={x(sample.time)} cy={y(sample.value)} r={3} fill={row.color} stroke={colors.surface} strokeWidth={1.5} /> : null}
                                </g>
                            ) : (
                                <line key={sampleIndex} x1={x(sample.time)} x2={x(sample.time)} y1={base} y2={base - 3} stroke={row.color} strokeOpacity={0.5} />
                            )
                        ))}
                    </g>
                );
            })}
            {ticks.map(tick => (
                <g key={tick}>
                    <line x1={x(tick * 1_000)} x2={x(tick * 1_000)} y1={height - AXIS_HEIGHT} y2={height - AXIS_HEIGHT + 4} stroke={colors.chartAxis} />
                    <text x={x(tick * 1_000)} y={height - AXIS_HEIGHT + 17} textAnchor={tick === 0 ? "start" : tick === 60 ? "end" : "middle"} fontSize="11" fill={colors.inkMuted}>{tick} s</text>
                </g>
            ))}
        </svg>
    );
}

function statisticRows(closed : ProbeStatistics, open : ProbeStatistics) : Array<Record<string, string>> {
    const ms = (value : number | undefined) : string => (value === undefined ? "–" : formatMs(value));
    const share = (statistics : ProbeStatistics) : string => `${statistics.longCount} (${formatPercent(statistics.count > 0 ? (statistics.longCount / statistics.count) * 100 : undefined)})`;
    return [
        { statistic : "Number of samples", closed : formatNumber(closed.count, 0), open : formatNumber(open.count, 0) },
        { statistic : "Samples of 1 s or more", closed : share(closed), open : share(open) },
        { statistic : "95th percentile", closed : ms(closed.p95), open : ms(open.p95) },
        { statistic : "Mean", closed : ms(closed.mean), open : ms(open.mean) },
        { statistic : "Sum", closed : ms(closed.sum), open : "Not applicable" },
    ];
}

/**
 * The closed-loop and open-loop explainer. The reader moves one block in a
 * visible minute. The explainer shows the samples and the statistics of
 * DriftLag and of the worker heartbeat.
 */
export default function ProbeLoops() {
    const [blockStart, setBlockStart] = useState(15_000);
    const [blockDuration, setBlockDuration] = useState(30_000);
    const [heartbeatMs, setHeartbeatMs] = useState<number>(1_000);
    const drawingRef = useRef<HTMLDivElement>(null);
    const width = useElementWidth(drawingRef) || 640;
    const ids = { start : useId(), duration : useId(), heartbeat : useId() };
    const colors = useThemeColors();

    const scenario : ProbeScenario = useMemo(() => ({
        periodMs : PERIOD_MS,
        block : { start : blockStart, duration : Math.min(blockDuration, PERIOD_MS - blockStart) },
        windowMs : 100,
        heartbeatMs,
    }), [blockStart, blockDuration, heartbeatMs]);
    const closed = useMemo(() => closedLoopSamples(scenario), [scenario]);
    const open = useMemo(() => openLoopSamples(scenario), [scenario]);
    const closedStatistics = statisticsOf(closed);
    const openStatistics = statisticsOf(open);
    const duration = scenario.block.duration;
    const maxValue = Math.max(1_000, duration);

    return (
        <Explainer
            title="Move a block in a visible minute, and compare the two probes"
            caption={
                <>
                    The model has one block in 60 s of visible time, DriftLag windows of 100 ms and a worker heartbeat on a
                    fixed schedule. The statistics use the nearest-rank percentile. Each vertical line is one sample, and its
                    height is its value. The hatched band is the block.
                </>
            }
        >
            <fieldset className={styles.controls}>
                <legend className="visually-hidden">The block and the heartbeat</legend>
                <label className={styles.field} htmlFor={ids.start}>
                    <span className={styles.fieldLabel}>Start of the block <span className={styles.fieldValue}>{formatMs(blockStart)}</span></span>
                    <input id={ids.start} type="range" min={0} max={55_000} step={1_000} value={blockStart} onChange={event => setBlockStart(Number(event.target.value))} />
                </label>
                <label className={styles.field} htmlFor={ids.duration}>
                    <span className={styles.fieldLabel}>Duration of the block <span className={styles.fieldValue}>{formatMs(duration)}</span></span>
                    <input id={ids.duration} type="range" min={0} max={40_000} step={500} value={blockDuration} onChange={event => setBlockDuration(Number(event.target.value))} />
                </label>
                <label className={styles.field} htmlFor={ids.heartbeat}>
                    <span className={styles.fieldLabel}>Heartbeat interval of the worker</span>
                    <select id={ids.heartbeat} className="control" value={heartbeatMs} onChange={event => setHeartbeatMs(Number(event.target.value))}>
                        {HEARTBEATS.map(interval => <option key={interval} value={interval}>{formatMs(interval)}</option>)}
                    </select>
                </label>
            </fieldset>

            <div ref={drawingRef} className={styles.drawing} role="img" aria-label={
                `DriftLag gives ${closedStatistics.count} windows, and ${closedStatistics.longCount} of them shows the block. `
                + `The worker sends ${openStatistics.count} heartbeats, and ${openStatistics.longCount} of them wait 1 s or more.`
            }>
                <Drawing
                    width={width}
                    block={scenario.block}
                    maxValue={maxValue}
                    rows={[
                        { label : `DriftLag windows, closed loop: ${formatNumber(closedStatistics.count, 0)} samples`, samples : closed, color : colors.series[0]!, dots : true },
                        { label : `Worker heartbeats, open loop: ${formatNumber(openStatistics.count, 0)} samples`, samples : open, color : colors.series[1]!, dots : true },
                    ]}
                />
            </div>

            <div className={styles.tableBlock}>
                <DataTable
                    label="The statistics of the two probes"
                    spec={{
                        caption : "The statistics of the two probes",
                        columns : [
                            { key : "statistic", label : "Statistic" },
                            { key : "closed", label : "DriftLag (closed loop)", align : "right" },
                            { key : "open", label : "Worker heartbeat (open loop)", align : "right" },
                        ],
                        rows : statisticRows(closedStatistics, openStatistics),
                    }}
                />
            </div>

            <div className={styles.readout}>
                <p>
                    An event at a random time of the minute waits {formatMs(randomEventDelay(scenario))} on average. The mean of the
                    heartbeats is {openStatistics.mean === undefined ? "–" : formatMs(openStatistics.mean)}. The 95th percentile of
                    DriftLag is {closedStatistics.p95 === undefined ? "–" : formatMs(closedStatistics.p95)}.
                </p>
                <p>
                    The sum of DriftLag is the blocked time: {formatMs(closedStatistics.sum)} of {PERIOD_MS / 1_000} s, or{" "}
                    {formatPercent((closedStatistics.sum / PERIOD_MS) * 100)} of the minute.
                </p>
            </div>
        </Explainer>
    );
}
