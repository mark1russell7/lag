import { useId, useRef } from "react";
import { useElementWidth } from "../../lib/use-element-width";
import type { PlaygroundSnapshot } from "../../playground/session";
import { snapshotLanes, type StripLaneId } from "./strip";
import styles from "./Hero.module.css";

/** The strip shows the last seconds of the session. */
export const STRIP_SECONDS = 6;
const LABEL_WIDTH = 64;
const LANE_HEIGHT = 16;
const LANE_GAP = 6;
const AXIS_HEIGHT = 14;
const FALLBACK_WIDTH = 420;

const MARK_CLASS : Readonly<Record<StripLaneId, string | undefined>> = {
    load : styles.markLoad,
    drift : undefined,
    worker : undefined,
    frames : undefined,
    input : styles.markInput,
};

/**
 * The live strip: one lane for each monitor, on one time axis that moves
 * with the time. The marks are in the time of the session. Thus only the
 * transform of one group changes at each snapshot, and a CSS transition
 * makes the move smooth.
 */
export function LiveStrip({ snapshot } : { snapshot : PlaygroundSnapshot }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const measured = useElementWidth(boxRef);
    const width = measured > 0 ? measured : FALLBACK_WIDTH;
    const clipId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-clip`;
    const plotWidth = Math.max(1, width - LABEL_WIDTH);
    const scale = plotWidth / STRIP_SECONDS;
    const now = snapshot.elapsedSeconds;
    // One second more than the visible range: the marks stay while the transition moves them out
    const lanes = snapshotLanes(snapshot, STRIP_SECONDS + 1);
    const height = AXIS_HEIGHT + lanes.length * (LANE_HEIGHT + LANE_GAP);
    const shift = LABEL_WIDTH + plotWidth - now * scale;
    const seconds = Array.from({ length : STRIP_SECONDS + 2 }, (_, index) => Math.floor(now) - index).filter(second => second >= 0);

    return (
        <div ref={boxRef} className={styles.strip}>
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`The last ${STRIP_SECONDS} seconds of this tab. ${lanes.map(lane => `${lane.label}: ${lane.description}`).join(" ")}`}>
                <defs>
                    <clipPath id={clipId}>
                        <rect x={LABEL_WIDTH} y={0} width={plotWidth} height={height} />
                    </clipPath>
                </defs>
                <text x={LABEL_WIDTH} y={10} className={styles.stripAxis}>−{STRIP_SECONDS} s</text>
                <text x={width - 2} y={10} className={styles.stripAxis} textAnchor="end">0 s</text>
                {lanes.map((lane, index) => {
                    const top = AXIS_HEIGHT + index * (LANE_HEIGHT + LANE_GAP);
                    return (
                        <g key={lane.id}>
                            <text x={0} y={top + LANE_HEIGHT - 4} className={styles.stripLabel}>{lane.label}</text>
                            <rect x={LABEL_WIDTH} y={top} width={plotWidth} height={LANE_HEIGHT} className={styles.stripTrack} />
                        </g>
                    );
                })}
                <g clipPath={`url(#${clipId})`}>
                    <g className={styles.stripContent} style={{ transform : `translateX(${shift.toFixed(1)}px)` }}>
                        {seconds.map(second => (
                            <line key={second} x1={second * scale} x2={second * scale} y1={AXIS_HEIGHT - 2} y2={height} className={styles.stripGrid} />
                        ))}
                        {lanes.map((lane, index) => {
                            const top = AXIS_HEIGHT + index * (LANE_HEIGHT + LANE_GAP);
                            const markClass = MARK_CLASS[lane.id];
                            return (
                                <g key={lane.id}>
                                    {lane.ticks.map((t, tick) => (
                                        <line key={tick} x1={t * scale} x2={t * scale} y1={top + LANE_HEIGHT - 5} y2={top + LANE_HEIGHT} className={styles.stripTick} />
                                    ))}
                                    {lane.marks.map(mark => (
                                        <rect
                                            key={`${mark.start}-${mark.end}`}
                                            x={mark.start * scale}
                                            y={top + 2}
                                            width={Math.max(2, (mark.end - mark.start) * scale)}
                                            height={LANE_HEIGHT - 4}
                                            rx={2}
                                            className={markClass ?? (mark.strong ? styles.markLong : styles.markShort)}
                                        />
                                    ))}
                                </g>
                            );
                        })}
                    </g>
                </g>
            </svg>
        </div>
    );
}
