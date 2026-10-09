import {
    memo,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import { DataTableDisclosure, type DataTableSpec } from "../../components/DataTable/DataTable";
import { formatCount, formatMs } from "../../lib/format";
import { useMediaQuery, usePrefersReducedMotion } from "../../lib/use-media-query";
import { useElementWidth } from "../../lib/use-element-width";
import { ChartLegend, type LegendItem } from "../../results/components/ChartLegend";
import { mixColor, useThemeColors } from "../../theme/colors";
import { drawTimeline, overviewBounds, plotArea, timelinePalette, type OverviewCache, type TimelinePalette } from "./draw";
import {
    adjacentItem,
    describeItem,
    formatSeconds,
    hitTest,
    itemKey,
    itemSentence,
    itemsInView,
    timelineItems,
    type TimelineItem,
} from "./items";
import type { TimelineModel } from "./model";
import { ALL_TRACKS, layoutTracks, TRACKS, type TrackId } from "./tracks";
import {
    clampViewport,
    DEFAULT_SPAN,
    fitViewport,
    followViewport,
    panViewport,
    span,
    xToTime,
    zoomViewport,
    type Bounds,
    type Viewport,
} from "./viewport";
import styles from "./SessionTimeline.module.css";

export type SessionTimelineProps = {
    model : TimelineModel;
    /**
     * The session clock, in ms. Between two models, the live edge moves with
     * it. The default is `performance.now()`.
     */
    clock? : () => number;
};

/** The table shows at most this number of items. */
const TABLE_LIMIT = 300;
/** The live edge moves at most 1 s past the newest model. */
const MAX_EXTRAPOLATION = 1;
const ZOOM_STEP = 1.25;

const performanceClock = () : number => performance.now();

type Hover = { x : number; y : number; item : TimelineItem | undefined };

function trackColor(id : TrackId, palette : TimelinePalette) : string {
    switch (id) {
        case "pageViews": return palette.accent;
        case "lifecycle": return palette.lifecycle;
        case "loads": return palette.load;
        case "drift": return palette.drift;
        case "macrotask": return palette.macrotask;
        case "frames": return palette.mark;
        case "blocks": return palette.mark;
        case "vitals": return palette.interaction;
        case "pressure": return palette.pressure;
    }
}

function boundsOf(model : TimelineModel, now : number) : Bounds {
    return { start : model.start, end : Math.max(now, model.start + 0.001) };
}

function readFonts(element : Element | null) : { sans : string; mono : string } {
    if (!element || typeof getComputedStyle === "undefined") return { sans : "sans-serif", mono : "monospace" };
    const root = getComputedStyle(document.documentElement);
    return {
        sans : getComputedStyle(element).fontFamily || "sans-serif",
        mono : root.getPropertyValue("--font-mono").trim() || "monospace",
    };
}

/** The check boxes of the tracks. On a narrow screen, they are behind a disclosure. */
const TrackToggles = memo(function TrackToggles({ visible, palette, onToggle } : {
    visible : ReadonlySet<TrackId>;
    palette : TimelinePalette;
    onToggle : (id : TrackId) => void;
}) {
    const narrow = useMediaQuery("(max-width: 40rem)");
    const boxes = (
        <fieldset className={styles.tracks}>
            <legend className="visually-hidden">Tracks</legend>
            {TRACKS.map(track => (
                <label key={track.id} className={styles.track} title={track.description}>
                    <input type="checkbox" checked={visible.has(track.id)} onChange={() => onToggle(track.id)} />
                    <span className={styles.swatch} style={{ background : trackColor(track.id, palette) }} aria-hidden="true" />
                    {track.label}
                </label>
            ))}
        </fieldset>
    );
    if (!narrow) return boxes;
    return (
        <details className={styles.trackMenu}>
            <summary>Tracks ({visible.size} of {TRACKS.length})</summary>
            {boxes}
        </details>
    );
});

function ItemDetails({ item, onZoom, onClose } : { item : TimelineItem; onZoom : () => void; onClose : () => void }) {
    const description = describeItem(item);
    return (
        <section className={styles.details} aria-label="Selected item">
            <div className={styles.detailsHeader}>
                <p className={styles.detailsTitle}>{description.title}</p>
                <p className={styles.detailsValue}>{description.value}</p>
                <div className={styles.detailsActions}>
                    <button type="button" className={`button ${styles.small}`} onClick={onZoom}>Zoom to the item</button>
                    <button type="button" className={`button ${styles.small}`} onClick={onClose}>Close</button>
                </div>
            </div>
            <dl className={styles.detailsRows}>
                {description.rows.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
            </dl>
        </section>
    );
}

function tableSpec(items : readonly TimelineItem[], view : Viewport) : DataTableSpec {
    const visible = itemsInView(items, view);
    const shown = visible.slice(-TABLE_LIMIT);
    return {
        caption : visible.length > TABLE_LIMIT
            ? `The newest ${TABLE_LIMIT} of ${visible.length} items from ${formatSeconds(view.start)} to ${formatSeconds(view.end)}`
            : `${visible.length} items from ${formatSeconds(view.start)} to ${formatSeconds(view.end)}`,
        columns : [
            { key : "start", label : "Start (s)", align : "right", format : value => (value as number).toFixed(2) },
            { key : "end", label : "End (s)", align : "right", format : value => (value as number).toFixed(2) },
            { key : "title", label : "Item" },
            { key : "value", label : "Value", align : "right" },
            { key : "details", label : "Details" },
        ],
        rows : shown.map(item => {
            const description = describeItem(item);
            return {
                start : item.start,
                end : item.end,
                title : description.title,
                value : description.value,
                details : description.rows.filter(([label]) => label !== "Time").map(([label, value]) => `${label}: ${value}`).join("; "),
            };
        }),
    };
}

/** The items of the visible range as a table. The table renders only while it is open. */
const TimelineTable = memo(function TimelineTable({ items, view } : { items : readonly TimelineItem[]; view : Viewport }) {
    return <DataTableDisclosure lazy spec={() => tableSpec(items, view)} title="Session timeline" />;
});

/**
 * The timeline of the live session, as in the performance panel of the
 * browser developer tools. A canvas draws the tracks. The reader can zoom
 * and pan with the wheel, the pointer and the keyboard. In the "follow
 * live" mode, the timeline shows the newest data.
 */
export function SessionTimeline({ model, clock = performanceClock } : SessionTimelineProps) {
    const helpId = useId();
    const summaryId = useId();
    const hostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const width = useElementWidth(hostRef);
    const theme = useThemeColors();
    const palette = useMemo(() => timelinePalette(theme), [theme]);
    const reducedMotion = usePrefersReducedMotion();

    const [visible, setVisible] = useState<ReadonlySet<TrackId>>(ALL_TRACKS);
    const layout = useMemo(() => layoutTracks(visible), [visible]);
    const items = useMemo(() => timelineItems(model, visible), [model, visible]);
    const [following, setFollowing] = useState(true);
    const [view, setView] = useState<Viewport>(() => ({ start : model.now - DEFAULT_SPAN, end : model.now }));
    const [hover, setHover] = useState<Hover>();
    const [selectedKey, setSelectedKey] = useState<string>();
    const [announcement, setAnnouncement] = useState("");
    const [engaged, setEngaged] = useState(false);
    const [hint, setHint] = useState(false);
    const selected = useMemo(() => (selectedKey ? items.find(item => itemKey(item) === selectedKey) : undefined), [items, selectedKey]);

    // The draw loop reads refs, so that a pointer move or an animation frame does not render React again
    const viewportRef = useRef<Viewport>(view);
    const receivedAtRef = useRef(clock());
    const modelRef = useRef(model);
    const hoverRef = useRef<Hover | undefined>(undefined);
    const drawRef = useRef<() => void>(() => {});
    const frameRef = useRef(0);
    const followingRef = useRef(following);
    followingRef.current = following;
    // The font families do not change. Thus the draw loop reads the styles only one time.
    const fontsRef = useRef<{ sans : string; mono : string } | undefined>(undefined);
    const overviewCache = useRef<OverviewCache>({ current : undefined });

    const liveNow = useCallback(() : number => {
        const current = modelRef.current;
        if (!current.running) return current.now;
        const elapsed = (clock() - receivedAtRef.current) / 1000;
        return current.now + Math.min(MAX_EXTRAPOLATION, Math.max(0, elapsed));
    }, [clock]);

    drawRef.current = () => {
        const canvas = canvasRef.current;
        if (!canvas || width === 0) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const ratio = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(layout.height * ratio);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }
        canvas.style.width = `${width}px`;
        canvas.style.height = `${layout.height}px`;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const current = hoverRef.current;
        drawTimeline(context, {
            model : modelRef.current,
            layout,
            viewport : viewportRef.current,
            bounds : boundsOf(modelRef.current, liveNow()),
            width,
            hover : current ? { x : current.x, item : current.item } : undefined,
            selected,
            fonts : fontsRef.current ??= readFonts(canvas),
            overviewCache : overviewCache.current,
        }, palette);
    };

    const requestDraw = useCallback(() => {
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = 0;
            drawRef.current();
        });
    }, []);

    useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

    /** This function shows a new range. A pan or a zoom by the reader stops the "follow live" mode. */
    const applyViewport = useCallback((next : Viewport, keepFollowing = false) => {
        const clamped = clampViewport(next, boundsOf(modelRef.current, liveNow()));
        viewportRef.current = clamped;
        if (!keepFollowing) setFollowing(false);
        setView(clamped);
        requestDraw();
    }, [liveNow, requestDraw]);

    // A new model: the live edge starts from its time
    useLayoutEffect(() => {
        modelRef.current = model;
        receivedAtRef.current = clock();
        if (followingRef.current) {
            const next = followViewport(viewportRef.current, model.now, model.start);
            viewportRef.current = next;
            setView(next);
        }
        drawRef.current();
    }, [model, clock]);

    // Draw again when the size, the theme, the tracks or the selection change
    useLayoutEffect(() => {
        drawRef.current();
    }, [width, palette, layout, selected]);

    // The "follow live" mode moves the live edge in each animation frame, except with reduced motion
    useEffect(() => {
        if (!following || !model.running || reducedMotion) return undefined;
        let handle = 0;
        let lastViewUpdate = 0;
        const step = (time : number) : void => {
            viewportRef.current = followViewport(viewportRef.current, liveNow(), modelRef.current.start);
            drawRef.current();
            if (time - lastViewUpdate > 500) {
                lastViewUpdate = time;
                setView(viewportRef.current);
            }
            handle = requestAnimationFrame(step);
        };
        handle = requestAnimationFrame(step);
        return () => cancelAnimationFrame(handle);
    }, [following, model.running, reducedMotion, liveNow]);

    const plotX = (clientX : number) : number => {
        const rect = canvasRef.current?.getBoundingClientRect();
        return rect ? clientX - rect.left : 0;
    };
    const plotY = (clientY : number) : number => {
        const rect = canvasRef.current?.getBoundingClientRect();
        return rect ? clientY - rect.top : 0;
    };

    const timeAt = (x : number) : number => {
        const area = plotArea(width);
        return xToTime(x - area.left, viewportRef.current, area.width);
    };

    const zoomBy = useCallback((factor : number, anchor? : number) => {
        const viewport = viewportRef.current;
        const bounds = boundsOf(modelRef.current, liveNow());
        if (followingRef.current && anchor === undefined) {
            // Zoom around the live edge, and keep following
            const next = zoomViewport(viewport, factor, viewport.end, bounds);
            applyViewport(followViewport(next, liveNow(), modelRef.current.start), true);
            return;
        }
        applyViewport(zoomViewport(viewport, factor, anchor ?? (viewport.start + viewport.end) / 2, bounds));
    }, [applyViewport, liveNow]);

    const panBy = useCallback((fraction : number) => {
        const viewport = viewportRef.current;
        applyViewport(panViewport(viewport, span(viewport) * fraction, boundsOf(modelRef.current, liveNow())));
    }, [applyViewport, liveNow]);

    const showAll = useCallback(() => {
        applyViewport(fitViewport(boundsOf(modelRef.current, liveNow())));
    }, [applyViewport, liveNow]);

    const startFollowing = useCallback(() => {
        const next = followViewport(viewportRef.current, liveNow(), modelRef.current.start);
        viewportRef.current = next;
        setView(next);
        setFollowing(true);
        requestDraw();
    }, [liveNow, requestDraw]);

    const select = useCallback((item : TimelineItem | undefined, announce : boolean) => {
        setSelectedKey(item ? itemKey(item) : undefined);
        if (item && announce) setAnnouncement(itemSentence(item));
        requestDraw();
    }, [requestDraw]);

    /** This function moves the range so that the item is visible, and selects it. */
    const reveal = useCallback((item : TimelineItem) => {
        const viewport = viewportRef.current;
        const width = span(viewport);
        if (item.start < viewport.start || item.end > viewport.end) {
            const middle = (item.start + item.end) / 2;
            const next = Math.max(width, (item.end - item.start) * 1.2);
            applyViewport({ start : middle - next / 2, end : middle + next / 2 });
        }
        select(item, true);
    }, [applyViewport, select]);

    const zoomToItem = useCallback((item : TimelineItem) => {
        const length = Math.max(0.2, (item.end - item.start) * 1.6);
        const middle = (item.start + item.end) / 2;
        applyViewport({ start : middle - length / 2, end : middle + length / 2 });
    }, [applyViewport]);

    // Pointer: drag to pan, two pointers to zoom, a click to select, the overview to move the range
    const pointers = useRef(new Map<number, { x : number; y : number }>());
    const gesture = useRef<{ kind : "pan" | "overview" | "pinch"; startX : number; startY : number; viewport : Viewport; distance : number; moved : boolean } | undefined>(undefined);

    const inOverview = (y : number) : boolean => y >= layout.overviewTop && y <= layout.overviewTop + layout.overviewHeight;

    const centerOnOverview = (x : number) : void => {
        const area = plotArea(width);
        // The overview shows the time range of the model (refer to overviewBounds)
        const bounds = overviewBounds(modelRef.current);
        const time = bounds.start + ((x - area.left) / area.width) * (bounds.end - bounds.start);
        const length = span(viewportRef.current);
        applyViewport({ start : time - length / 2, end : time + length / 2 });
    };

    const onPointerDown = (event : ReactPointerEvent<HTMLCanvasElement>) : void => {
        const x = plotX(event.clientX);
        const y = plotY(event.clientY);
        pointers.current.set(event.pointerId, { x, y });
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setEngaged(true);
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current = { kind : "pinch", startX : (a!.x + b!.x) / 2, startY : 0, viewport : viewportRef.current, distance : Math.abs(a!.x - b!.x), moved : true };
            return;
        }
        const kind = inOverview(y) ? "overview" : "pan";
        gesture.current = { kind, startX : x, startY : y, viewport : viewportRef.current, distance : 0, moved : false };
        if (kind === "overview") centerOnOverview(x);
    };

    const onPointerMove = (event : ReactPointerEvent<HTMLCanvasElement>) : void => {
        const x = plotX(event.clientX);
        const y = plotY(event.clientY);
        if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x, y });
        const active = gesture.current;
        if (active?.kind === "pinch" && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const distance = Math.max(10, Math.abs(a!.x - b!.x));
            const area = plotArea(width);
            const anchor = xToTime(active.startX - area.left, active.viewport, area.width);
            applyViewport(zoomViewport(active.viewport, Math.max(10, active.distance) / distance, anchor, boundsOf(modelRef.current, liveNow())));
            return;
        }
        if (active?.kind === "overview") {
            centerOnOverview(x);
            return;
        }
        if (active?.kind === "pan") {
            const dx = x - active.startX;
            if (!active.moved && Math.abs(dx) < 4) return;
            active.moved = true;
            const area = plotArea(width);
            applyViewport(panViewport(active.viewport, (-dx / area.width) * span(active.viewport), boundsOf(modelRef.current, liveNow())));
            return;
        }
        // Hover: the item under the pointer
        const area = plotArea(width);
        const item = hitTest(modelRef.current, layout, viewportRef.current, area.width, x - area.left, y);
        const next = { x, y, item };
        hoverRef.current = next;
        setHover(next);
        requestDraw();
    };

    const endPointer = (event : ReactPointerEvent<HTMLCanvasElement>) : void => {
        const active = gesture.current;
        pointers.current.delete(event.pointerId);
        if (pointers.current.size > 0) return;
        gesture.current = undefined;
        if (active?.kind === "pan" && !active.moved) {
            const area = plotArea(width);
            const item = hitTest(modelRef.current, layout, viewportRef.current, area.width, active.startX - area.left, active.startY);
            select(item && selectedKey !== itemKey(item) ? item : undefined, false);
        }
    };

    const onPointerLeave = () : void => {
        hoverRef.current = undefined;
        setHover(undefined);
        requestDraw();
    };

    // The wheel: Ctrl or Command + wheel (and the pinch of a touchpad) zooms. A horizontal wheel pans.
    // After a click into the timeline, the wheel zooms without a key.
    useEffect(() => {
        const host = canvasRef.current;
        if (!host) return undefined;
        let hintTimer = 0;
        const onWheel = (event : WheelEvent) : void => {
            const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
            const area = plotArea(width);
            if (horizontal) {
                event.preventDefault();
                const delta = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
                panBy(delta / area.width);
                return;
            }
            if (!(event.ctrlKey || event.metaKey || engaged)) {
                setHint(true);
                window.clearTimeout(hintTimer);
                hintTimer = window.setTimeout(() => setHint(false), 1500);
                return;
            }
            event.preventDefault();
            const rect = host.getBoundingClientRect();
            const anchor = xToTime(event.clientX - rect.left - area.left, viewportRef.current, area.width);
            zoomBy(Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.0025))), anchor);
        };
        host.addEventListener("wheel", onWheel, { passive : false });
        return () => {
            host.removeEventListener("wheel", onWheel);
            window.clearTimeout(hintTimer);
        };
    }, [width, engaged, panBy, zoomBy]);

    const onKeyDown = (event : KeyboardEvent<HTMLDivElement>) : void => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const large = event.shiftKey;
        switch (event.key) {
            case "ArrowLeft": case "a": case "A": panBy(large ? -0.5 : -0.1); break;
            case "ArrowRight": case "d": case "D": panBy(large ? 0.5 : 0.1); break;
            case "+": case "=": case "w": case "W": zoomBy(1 / ZOOM_STEP); break;
            case "-": case "_": case "s": case "S": zoomBy(ZOOM_STEP); break;
            case "0": showAll(); break;
            case "Home": applyViewport({ start : modelRef.current.start, end : modelRef.current.start + span(viewportRef.current) }); break;
            case "End": case "f": case "F": startFollowing(); break;
            case "]": case ".": {
                const next = adjacentItem(items, selected, (viewportRef.current.start + viewportRef.current.end) / 2, 1);
                if (next) reveal(next);
                break;
            }
            case "[": case ",": {
                const previous = adjacentItem(items, selected, (viewportRef.current.start + viewportRef.current.end) / 2, -1);
                if (previous) reveal(previous);
                break;
            }
            case "Enter": if (selected) zoomToItem(selected); break;
            case "Escape": select(undefined, false); break;
            default: return;
        }
        event.preventDefault();
    };

    const toggleTrack = useCallback((id : TrackId) => {
        setVisible(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const counts = [
        formatCount(model.frames.length, "long frame"),
        formatCount(model.hangs.length, "hang"),
        formatCount(model.stalls.length, "stall"),
        formatCount(model.interactions.length, "interaction"),
    ].join(", ");
    const highestDrift = model.drift.reduce((highest, point) => Math.max(highest, point.value), Number.NEGATIVE_INFINITY);
    const hoverText = hover?.item ? describeItem(hover.item) : undefined;
    const legend : LegendItem[] = [
        { label : "Blocking time", color : palette.mark },
        { label : "Rest of a long frame", color : mixColor(palette.mark, palette.surface, 0.2) },
        { label : "Stall (hatched box)", color : mixColor(palette.mark, palette.surface, 0.45) },
        { label : "Interaction", color : palette.interaction },
        { label : "Layout shift", color : palette.shift },
        { label : "Vital: good", color : palette.rating.good },
        { label : "Vital: needs improvement", color : palette.rating["needs-improvement"] },
        { label : "Vital: poor", color : palette.rating.poor },
    ];

    return (
        <div className={styles.panel}>
            <div className={styles.toolbar}>
                <TrackToggles visible={visible} palette={palette} onToggle={toggleTrack} />
                <div className={styles.controls} role="group" aria-label="Time range">
                    <button type="button" className={`button ${styles.small}`} onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom out">−</button>
                    <button type="button" className={`button ${styles.small}`} onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom in">+</button>
                    <button type="button" className={`button ${styles.small}`} onClick={showAll}>Show all</button>
                    <button
                        type="button"
                        className={`button ${styles.small} ${styles.follow}`}
                        aria-pressed={following}
                        onClick={() => (following ? setFollowing(false) : startFollowing())}
                    >
                        <span className={styles.liveDot} data-live={following && model.running ? "true" : undefined} aria-hidden="true" />
                        Follow live
                    </button>
                </div>
            </div>

            <div
                ref={hostRef}
                className={styles.host}
                tabIndex={0}
                role="application"
                aria-roledescription="timeline"
                aria-label="Session timeline"
                aria-describedby={`${summaryId} ${helpId}`}
                onKeyDown={onKeyDown}
                onFocus={() => setEngaged(true)}
                onBlur={() => setEngaged(false)}
            >
                <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    // The height is known before the first draw, thus the page does not shift
                    style={{ height : `${layout.height}px` }}
                    aria-hidden="true"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endPointer}
                    onPointerCancel={endPointer}
                    onPointerLeave={onPointerLeave}
                />
                {hover && !gesture.current ? (
                    <div className={styles.timePill} style={{ left : `${hover.x}px` }} aria-hidden="true">
                        {formatSeconds(timeAt(hover.x))}
                    </div>
                ) : null}
                {hover && hoverText ? (
                    <div
                        className={styles.tooltip}
                        aria-hidden="true"
                        style={{
                            top : `${Math.min(hover.y + 14, Math.max(0, layout.height - 150))}px`,
                            ...(hover.x > width / 2 ? { right : `${width - hover.x + 14}px` } : { left : `${hover.x + 14}px` }),
                        }}
                    >
                        <p className={styles.tooltipValue}>{hoverText.value}</p>
                        <p className={styles.tooltipTitle}>{hoverText.title}</p>
                        <dl>
                            {hoverText.rows.slice(0, 6).map(([label, value]) => (
                                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                            ))}
                        </dl>
                    </div>
                ) : null}
                {hint ? <p className={styles.hint} aria-hidden="true">Hold Ctrl (or Command) and use the wheel to zoom. Or click the timeline first.</p> : null}
            </div>

            <ChartLegend items={legend} label="Marks of the timeline" />
            <p id={summaryId} className={styles.summary}>
                {`From ${formatSeconds(view.start)} to ${formatSeconds(view.end)}${following ? " (live)" : ""}. The session has ${counts}.`}
                {model.drift.length > 0 ? ` The highest drift lag is ${formatMs(highestDrift)}.` : ""}
            </p>
            <p id={helpId} className={styles.help}>
                Drag to move the time range, or use the overview at the bottom. Keys: the arrows (or A and D) move, and + and −
                (or W and S) zoom. 0 shows all, and F follows live. Comma and period go to the previous and the next item, and
                Enter zooms to it.
            </p>
            <p className="visually-hidden" aria-live="polite">{announcement}</p>
            {selected ? <ItemDetails item={selected} onZoom={() => zoomToItem(selected)} onClose={() => select(undefined, false)} /> : null}
            <TimelineTable items={items} view={view} />
        </div>
    );
}
