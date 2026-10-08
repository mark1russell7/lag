import { ObserverMonitor } from "../ObserverMonitor.js";
import { eventTime, isVisibleState, type LifecycleEventTarget, type LifecycleStateMachine, type StateTransition } from "../LifecycleStateMachine.js";
import type { PerformanceEntryLike, PerformanceObserverInit, PerformanceObserverOptions } from "../perf-types.js";
import type { RequestAnimationFrameFn } from "../FrameTimingMonitor.js";
import type { Clock, Logger } from "../types.js";
import { stripUrlParameters } from "../rate-limiter.js";
import { describeNode as defaultDescribeNode } from "./selector.js";
import { ViewCollector, type EventEntryLike, type LayoutShiftEntryLike, type PageView } from "./ViewCollector.js";
import type { NavigationType, PageSource, VitalName, VitalValue } from "./types.js";

/** The values of one page view at one checkpoint. */
export type VitalsReport = {
    view : PageView;
    values : VitalValue[];
    /** True when the view ended. No report for this view comes after it. */
    final : boolean;
};

export type PageViewVitalsDeps = {
    logger : Logger;
    /** `performance.now()`: the time base of the performance entries. */
    clock : Clock;
    PerformanceObserver : PerformanceObserverInit;
    lifecycle : LifecycleStateMachine;
    page? : PageSource;
    requestAnimationFrame? : RequestAnimationFrameFn;
    /** `() => performance.interactionCount`, where the browser has it. */
    readInteractionCount? : () => number | undefined;
    describeNode? : (node : unknown) => string;
    createId? : () => string;
    /**
     * The window, for the `keydown` and `click` events. As in web-vitals, the
     * first trusted key press or click after the start of a view makes its
     * LCP final. This is also true for an input that gives no Event Timing
     * entry (an input shorter than 16 ms).
     */
    inputTarget? : LifecycleEventTarget;
    /**
     * When true, each soft navigation (Chromium 151 and later) starts a new
     * page view, as web-vitals does with `reportSoftNavs`. The default is
     * false: the values then agree with CrUX, which does not split a load at
     * soft navigations.
     */
    softNavigations? : boolean;
};

type PaintLike = { renderTime? : number; element? : unknown; url? : string };

type LcpEntryLike = PerformanceEntryLike & { element? : unknown; url? : string };

type InteractionContentfulPaintLike = PerformanceEntryLike & {
    interactionId? : number;
    largestContentfulPaint? : PaintLike | null;
};

type SoftNavigationEntryLike = PerformanceEntryLike & {
    interactionId? : number;
    paintTime? : number;
    presentationTime? : number;
    getLargestInteractionContentfulPaint?() : InteractionContentfulPaintLike | null | undefined;
};

/** An entry that the browser did not deliver yet, with its observer. */
type PendingEntry = { observer : EntryObserver; entry : PerformanceEntryLike };

/** The smallest Event Timing threshold that browsers permit. */
const DURATION_THRESHOLD_MS = 16;

/**
 * The entry type that each vital needs. As in web-vitals, a vital whose type
 * the browser does not have gets no value, also not after a restore from the
 * back/forward cache. TTFB needs the navigation entry instead.
 */
const VITAL_ENTRY_TYPES : Readonly<Record<Exclude<VitalName, "TTFB">, string>> = {
    INP : "event",
    CLS : "layout-shift",
    LCP : "largest-contentful-paint",
    FCP : "paint",
};

/**
 * An observer of one entry type. It gives each delivery of the browser to
 * `onDelivery`, and each entry that it dispatches to `onEntry`.
 */
class EntryObserver extends ObserverMonitor {
    constructor(
        type : string,
        private readonly onEntry : (entry : PerformanceEntryLike) => void,
        private readonly onDelivery : (observer : EntryObserver, entries : readonly PerformanceEntryLike[]) => void,
        logger : Logger,
        Ctor : PerformanceObserverInit,
        options : PerformanceObserverOptions,
    ) {
        super(type, logger, Ctor, options);
    }

    protected override receive(entries : readonly PerformanceEntryLike[]) : void {
        this.onDelivery(this, entries);
    }

    /** This method removes and gives the entries that the browser did not deliver yet. */
    takePending() : PerformanceEntryLike[] {
        return this.takePendingEntries();
    }

    dispatch(entries : readonly PerformanceEntryLike[]) : void {
        this.processEntries(entries);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        this.onEntry(entry);
    }
}

function defaultCreateId() : string {
    return `lag-${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;
}

/**
 * The Core Web Vitals of each page view, with the rules of web-vitals.
 *
 * A page view starts at the load of the page. A restore from the
 * back/forward cache starts a new view. When `softNavigations` is true, a
 * soft navigation also starts a new view. For a prerendered page, the
 * measurement starts at the activation, and the load metrics count from the
 * activation.
 *
 * At each checkpoint, the instance gives the current values of the view to
 * `report`. These are the checkpoints:
 * - The page becomes hidden.
 * - A new view starts.
 * - `flush()`.
 * - `stop()`.
 *
 * The instance processes the entries of all observers in one sequence, by
 * time. At each delivery of the browser and before each checkpoint, it also
 * takes the entries that the browser did not deliver yet. Thus, each entry
 * goes to the correct view. This is also true when the browser gives the
 * entries to the observers in a different sequence. The caller decides what
 * to do with repeated reports.
 *
 * The load metrics (FCP, LCP) of the first view count only before the page
 * was hidden for the first time. A page that loads in a background tab has
 * no applicable paint metrics.
 *
 * Some browsers do not have the entry type of a vital, for example
 * `layout-shift` (CLS) in Firefox and Safari. As in web-vitals, such a vital
 * has no value.
 */
export class PageViewVitals {
    private collector : ViewCollector;
    private readonly initialViewId : string;
    /** The activation time of a prerendered page, or 0. */
    private activationStart = 0;
    /** The first time that the page was hidden after the start of the current view. */
    private hiddenTime = Infinity;
    private hadNavigationEntry = false;
    private readonly observers : EntryObserver[] = [];
    private readonly disposers : Array<() => void> = [];
    private readonly viewListeners = new Set<(view : PageView) => void>();
    private started = false;
    private stopped = false;
    private draining = false;
    /** True after the final report of the current view: no report for it comes after that. */
    private ended = false;
    private readonly describe : (node : unknown) => string;
    private readonly createId : () => string;
    /** The vitals that this browser can measure. */
    private readonly measured : ReadonlySet<VitalName>;

    constructor(
        private readonly report : (report : VitalsReport) => void,
        private readonly deps : PageViewVitalsDeps,
    ) {
        this.describe = deps.describeNode ?? defaultDescribeNode;
        this.createId = deps.createId ?? defaultCreateId;
        const supported = deps.PerformanceObserver.supportedEntryTypes;
        this.measured = new Set<VitalName>([
            "TTFB",
            ...(Object.keys(VITAL_ENTRY_TYPES) as Array<keyof typeof VITAL_ENTRY_TYPES>)
                // Without the list of supported types, the instance tries all types
                .filter(name => !supported || supported.includes(VITAL_ENTRY_TYPES[name])),
        ]);

        const page = deps.page;
        const prerendering = page?.isPrerendering() === true;
        const navigation = page?.navigation();
        this.initialViewId = this.createId();
        this.collector = new ViewCollector({
            id : this.initialViewId,
            navigationType : initialNavigationType(page, prerendering),
            startTime : 0,
            ...(navigation ? { url : stripUrlParameters(navigation.url) } : {}),
        }, this.describe, deps.readInteractionCount);

        this.disposers.push(deps.lifecycle.subscribe((t) => this.onTransition(t)));
        if (prerendering && page) {
            // As web-vitals: start at the activation. The observers then get the earlier entries from the buffer.
            this.disposers.push(page.onActivation(() => this.start()));
        } else {
            this.start();
        }
    }

    /** The current page view. */
    getView() : PageView {
        return this.collector.view;
    }

    /** The current values of the current page view. */
    getValues() : VitalValue[] {
        return this.collector.values().filter(value => this.measured.has(value.name));
    }

    /** This method sends each new page view to `listener` when the view starts. It gives a function that removes the listener. */
    subscribe(listener : (view : PageView) => void) : () => void {
        this.viewListeners.add(listener);
        return () => { this.viewListeners.delete(listener); };
    }

    /**
     * This method reports the current values of the current view
     * immediately. Use it before an exporter flushes, so that the export
     * contains the latest values.
     */
    flush() : void {
        if (this.started && !this.stopped && !this.ended) this.checkpoint(false);
    }

    /** This method reports the current view as final and stops the observers. A stopped instance cannot start again. */
    stop() : void {
        if (this.stopped) return;
        if (!this.ended) this.checkpoint(true);
        this.stopped = true;
        for (const observer of this.observers) observer.stop();
        for (const dispose of this.disposers) dispose();
        this.viewListeners.clear();
    }

    private start() : void {
        if (this.started || this.stopped) return;
        this.started = true;

        const navigation = this.deps.page?.navigation();
        this.activationStart = navigation?.activationStart ?? 0;
        this.hiddenTime = this.initialHiddenTime();
        if (navigation) {
            this.hadNavigationEntry = true;
            this.collector.setTtfb(navigation.responseStart - this.activationStart);
        }

        this.observe("event", (e) => this.onEvent(e as unknown as EventEntryLike), { durationThreshold : DURATION_THRESHOLD_MS });
        // The browser delivers the first input for all durations
        this.observe("first-input", (e) => this.onEvent(e as unknown as EventEntryLike));
        this.observe("layout-shift", (e) => this.collector.addLayoutShift(e as unknown as LayoutShiftEntryLike));
        this.observe("paint", (e) => this.onPaint(e));
        this.observe("largest-contentful-paint", (e) => this.onLcp(e as LcpEntryLike));
        if (this.deps.softNavigations === true && this.isSupported("soft-navigation") && this.isSupported("interaction-contentful-paint")) {
            this.observe("soft-navigation", (e) => this.onSoftNavigation(e as SoftNavigationEntryLike));
            this.observe("interaction-contentful-paint", (e) => this.onInteractionContentfulPaint(e as InteractionContentfulPaintLike));
        }
        this.listenForInput();
    }

    /** The trusted `keydown` and `click` events make the LCP of the current view final (refer to `inputTarget`). */
    private listenForInput() : void {
        const target = this.deps.inputTarget;
        if (!target) return;
        const onInput = (event : unknown) : void => {
            if (this.stopped || (event as { isTrusted? : unknown } | undefined)?.isTrusted === false) return;
            const time = eventTime(event, this.deps.clock.now());
            if (time > this.collector.view.startTime) this.collector.finalizeLcpAt(time);
        };
        for (const type of ["keydown", "click"]) {
            target.addEventListener(type, onInput, { capture : true });
            this.disposers.push(() => target.removeEventListener(type, onInput, { capture : true }));
        }
    }

    /** The first hidden time of the first view, as web-vitals finds it. */
    private initialHiddenTime() : number {
        const hidden = this.deps.page?.hiddenTimes().filter(t => t >= this.activationStart) ?? [];
        if (hidden.length > 0) return Math.min(...hidden);
        // A page that is hidden at this time was possibly hidden from the start
        return isVisibleState(this.deps.lifecycle.getState()) ? Infinity : 0;
    }

    private isSupported(type : string) : boolean {
        return this.deps.PerformanceObserver.supportedEntryTypes?.includes(type) ?? false;
    }

    private observe(type : string, onEntry : (entry : PerformanceEntryLike) => void, options : PerformanceObserverOptions = {}) : void {
        // Make no observer (and no warning) for a type that the browser does not have
        const supported = this.deps.PerformanceObserver.supportedEntryTypes;
        if (supported && !supported.includes(type)) return;
        this.observers.push(new EntryObserver(
            type,
            (entry) => { if (!this.stopped) onEntry(entry); },
            (observer, entries) => this.onDelivery(observer, entries),
            this.deps.logger,
            this.deps.PerformanceObserver,
            options,
        ));
    }

    /**
     * Each delivery of the browser goes through this method. The method
     * merges the delivered entries with the entries that the other observers
     * did not get yet, and processes all of them in time order.
     */
    private onDelivery(observer : EntryObserver, entries : readonly PerformanceEntryLike[]) : void {
        if (this.draining) {
            observer.dispatch(entries);
            return;
        }
        this.dispatch(this.takePending({ observer, entries }));
    }

    private isInitialView() : boolean {
        return this.collector.view.id === this.initialViewId;
    }

    private onEvent(entry : EventEntryLike) : void {
        this.collector.addEvent(entry);
        // As web-vitals: a keydown or a click after the start of the view makes the LCP final.
        // The interaction that started a soft navigation has the start time of the view.
        if ((entry.name === "keydown" || entry.name === "click") && entry.startTime > this.collector.view.startTime) {
            this.collector.finalizeLcpAt(entry.startTime);
        }
    }

    private onPaint(entry : PerformanceEntryLike) : void {
        if (entry.name !== "first-contentful-paint" || !this.isInitialView()) return;
        if (entry.startTime >= this.hiddenTime) return;
        this.collector.setFcp(entry.startTime - this.activationStart);
    }

    private onLcp(entry : LcpEntryLike) : void {
        // `startTime` is the render time, or the load time when the render time is 0
        if (!this.isInitialView() || entry.startTime >= this.hiddenTime) return;
        this.collector.setLcp(entry.startTime - this.activationStart, this.paintAttribution(entry), entry.startTime);
    }

    /**
     * A soft navigation starts a new view. As in web-vitals, the interaction
     * that caused it stays in the view that ends. The entries of the
     * interaction start at the start of the soft navigation or before it.
     * Thus, the time order of the drain puts them first.
     */
    private onSoftNavigation(entry : SoftNavigationEntryLike) : void {
        this.startView("soft-navigation", entry.startTime, {
            ...(entry.interactionId ? { interactionId : entry.interactionId } : {}),
            url : stripUrlParameters(entry.name),
        }, () => {
            this.collector.setFcp((entry.presentationTime || entry.paintTime || 0) - entry.startTime);
            // The entry has the largest paint before it. Process that paint as if it occurred now,
            // before the later paints that the browser did not deliver yet.
            const largest = entry.getLargestInteractionContentfulPaint?.();
            if (largest) this.onInteractionContentfulPaint(largest);
        });
    }

    private onInteractionContentfulPaint(entry : InteractionContentfulPaintLike) : void {
        const view = this.collector.view;
        if (view.navigationType !== "soft-navigation") return;
        // Ignore the paints of other interactions
        if (entry.interactionId !== undefined && entry.interactionId !== view.interactionId) return;
        const paint = entry.largestContentfulPaint;
        const renderTime = paint?.renderTime || 0;
        if (renderTime >= this.hiddenTime) return;
        this.collector.setLcp(renderTime - entry.startTime, paint ? this.paintAttribution(paint) : {}, renderTime);
    }

    private paintAttribution(paint : { element? : unknown; url? : string }) : Record<string, string> {
        const attribution : Record<string, string> = {};
        if (paint.element) attribution["target"] = this.describe(paint.element);
        if (paint.url) attribution["url"] = stripUrlParameters(paint.url);
        return attribution;
    }

    private onTransition(transition : StateTransition) : void {
        if (!this.started || this.stopped) return;
        if (transition.trigger === "pageshow" && isVisibleState(transition.to)) {
            this.startView("back-forward-cache", transition.timestamp);
            return;
        }
        if (isVisibleState(transition.to)) return;
        if (this.hiddenTime === Infinity) this.hiddenTime = transition.timestamp;
        this.checkpoint(transition.to === "terminated");
    }

    /**
     * This method ends the current view and starts a new one. `initialize`
     * gives the first values of the new view.
     */
    private startView(navigationType : NavigationType, startTime : number, extra : Partial<PageView> = {}, initialize? : () => void) : void {
        if (this.stopped) return;
        // The entries that the browser did not deliver yet: the entries before the start of the new
        // view go to the view that ends, the others go to the new view. In a drain, the drain does this.
        const pending = this.draining ? [] : this.takePending();
        this.dispatch(pending.filter(item => item.entry.startTime < startTime));
        this.checkpoint(true);
        this.ended = false;
        const url = extra.url ?? this.collector.view.url;
        this.collector = new ViewCollector({
            ...extra,
            id : this.createId(),
            navigationType,
            startTime,
            ...(url !== undefined ? { url } : {}),
        }, this.describe, this.deps.readInteractionCount);
        // A restore and a soft navigation start while the page is visible
        this.hiddenTime = Infinity;
        for (const listener of [...this.viewListeners]) {
            try {
                listener(this.collector.view);
            } catch (error) {
                this.deps.logger.log("error", "Error in a page-view listener.", { error, type : "PageViewVitals" });
            }
        }
        // No network response: as web-vitals, TTFB is 0 when the load had a navigation entry
        if (this.hadNavigationEntry) this.collector.setTtfb(0);
        initialize?.();

        this.dispatch(pending.filter(item => item.entry.startTime >= startTime));

        const raf = this.deps.requestAnimationFrame;
        if (navigationType === "back-forward-cache" && raf) {
            // The browser has painted the restored page when two animation frames have started
            const collector = this.collector;
            raf(() => raf(() => {
                const value = this.deps.clock.now() - startTime;
                collector.setFcp(value);
                collector.setLcp(value);
            }));
        }
    }

    /**
     * This method takes the entries that the browser did not deliver yet,
     * from all observers, and puts `delivered` before the entries of its
     * observer. It merges the lists by start time. But it keeps the sequence
     * of the browser in each list. For example, the last LCP candidate stays
     * last, also when its start time (the load time) is earlier. At equal
     * start times, the observer that started first comes first.
     */
    private takePending(delivered? : { observer : EntryObserver; entries : readonly PerformanceEntryLike[] }) : PendingEntry[] {
        const lists = this.observers.map(observer => [
            ...(observer === delivered?.observer ? delivered.entries : []),
            ...observer.takePending(),
        ].map(entry => ({ observer, entry })));
        const merged : PendingEntry[] = [];
        for (;;) {
            let next : PendingEntry[] | undefined;
            for (const list of lists) {
                if (list.length > 0 && (!next || list[0]!.entry.startTime < next[0]!.entry.startTime)) next = list;
            }
            if (!next) return merged;
            merged.push(next.shift()!);
        }
    }

    /**
     * This method gives the entries to their observers, in sequence. A
     * soft-navigation entry among them starts a new view, and the entries
     * after it go to the new view.
     */
    private dispatch(pending : readonly PendingEntry[]) : void {
        if (pending.length === 0) return;
        const wasDraining = this.draining;
        this.draining = true;
        try {
            for (const { observer, entry } of pending) observer.dispatch([entry]);
        } finally {
            this.draining = wasDraining;
        }
    }

    private checkpoint(final : boolean) : void {
        if (this.ended) return;
        if (!this.draining) this.dispatch(this.takePending());
        if (final) this.ended = true;
        const values = this.getValues();
        if (values.length === 0 && !final) return;
        try {
            this.report({ view : this.collector.view, values, final });
        } catch (error) {
            this.deps.logger.log("error", "Error reporting page-view vitals.", { error, type : "PageViewVitals" });
        }
    }
}

/** The navigation type of the first view, in the sequence of web-vitals. */
function initialNavigationType(page : PageSource | undefined, prerendering : boolean) : NavigationType {
    const navigation = page?.navigation();
    if (prerendering || (navigation?.activationStart ?? 0) > 0) return "prerender";
    if (page?.wasDiscarded() === true) return "restore";
    return navigation?.type ?? "navigate";
}
