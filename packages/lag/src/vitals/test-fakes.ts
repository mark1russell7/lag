import { vi } from "vitest";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import type {
    PerformanceEntryLike,
    PerformanceEntryList,
    PerformanceObserverInit,
    PerformanceObserverInstance,
    PerformanceObserverOptions,
} from "../perf-types.js";
import type { NavigationInfo, PageSource } from "./types.js";

type Listener = (event : unknown) => void;

/** An event target that records the capture option of each listener. */
export function createFakeEventTarget() {
    const listeners : Array<{ type : string; listener : Listener; capture : boolean }> = [];
    return {
        addEventListener(type : string, listener : Listener, options? : { capture? : boolean }) {
            listeners.push({ type, listener, capture : options?.capture === true });
        },
        removeEventListener(type : string, listener : Listener, options? : { capture? : boolean }) {
            const index = listeners.findIndex(l => l.type === type && l.listener === listener && l.capture === (options?.capture === true));
            if (index >= 0) listeners.splice(index, 1);
        },
        /** This method sends the event to the capture listeners first, as a browser does at the target. */
        dispatch(type : string, event? : unknown) {
            const matching = listeners.filter(l => l.type === type);
            for (const l of [...matching.filter(m => m.capture), ...matching.filter(m => !m.capture)]) l.listener(event);
        },
        listeners() {
            return [...listeners];
        },
    };
}

/** A fake `PerformanceObserver`. `deliver` gives entries immediately. `queue` keeps them for `takeRecords`. */
export function createFakePerformanceObserver(supportedEntryTypes? : readonly string[]) {
    type Callback = (list : PerformanceEntryList, observer : PerformanceObserverInstance) => void;
    const observers = new Set<FakeObserver>();

    class FakeObserver implements PerformanceObserverInstance {
        static readonly supportedEntryTypes = supportedEntryTypes;
        type = "";
        options : PerformanceObserverOptions & { buffered? : boolean } = {};
        pending : PerformanceEntryLike[] = [];
        constructor(private readonly callback : Callback) {}
        observe(options : PerformanceObserverOptions & { type : string; buffered? : boolean }) {
            this.type = options.type;
            this.options = options;
            observers.add(this);
        }
        disconnect() {
            observers.delete(this);
        }
        takeRecords() {
            const records = this.pending;
            this.pending = [];
            return records;
        }
        notify(entries : PerformanceEntryLike[]) {
            this.callback({ getEntries : () => entries }, this);
        }
    }

    return {
        PerformanceObserver : FakeObserver as unknown as PerformanceObserverInit,
        deliver(type : string, ...entries : PerformanceEntryLike[]) {
            for (const observer of [...observers]) if (observer.type === type) observer.notify(entries);
        },
        queue(type : string, ...entries : PerformanceEntryLike[]) {
            for (const observer of observers) if (observer.type === type) observer.pending.push(...entries);
        },
        observedTypes() : string[] {
            return [...observers].map(o => o.type);
        },
        optionsOf(type : string) {
            return [...observers].find(o => o.type === type)?.options;
        },
    };
}

/** A real LifecycleStateMachine on fake `document` and `window` targets, with a settable clock. */
export function createFakeLifecycle(initialVisibility : "visible" | "hidden" = "visible") {
    let now = 0;
    const clock = { now : () => now };
    const document = Object.assign(createFakeEventTarget(), { visibilityState : initialVisibility as string, hasFocus : () => true });
    const window = createFakeEventTarget();
    const lifecycle = new LifecycleStateMachine(document, window, clock, { log : vi.fn() });
    return {
        lifecycle,
        clock,
        document,
        window,
        setNow(value : number) { now = value; },
        setVisibility(state : "visible" | "hidden", timeStamp? : number) {
            document.visibilityState = state;
            document.dispatch("visibilitychange", timeStamp === undefined ? {} : { timeStamp });
        },
        pagehide(persisted : boolean) { window.dispatch("pagehide", { persisted }); },
        pageshow(persisted : boolean, timeStamp? : number) { window.dispatch("pageshow", { persisted, ...(timeStamp === undefined ? {} : { timeStamp }) }); },
    };
}

export type FakePage = PageSource & {
    setPrerendering(value : boolean) : void;
    setNavigation(value : NavigationInfo | undefined) : void;
    activate() : void;
};

/** A page source with settable state. */
export function createFakePage(options : {
    navigation? : NavigationInfo | undefined;
    prerendering? : boolean;
    wasDiscarded? : boolean;
    hiddenTimes? : number[];
} = {}) : FakePage {
    let navigation = "navigation" in options ? options.navigation : { type : "navigate" as const, activationStart : 0, responseStart : 200, url : "https://shop.example/cart?item=7#top" };
    let prerendering = options.prerendering === true;
    const activationListeners = new Set<() => void>();
    return {
        navigation : () => navigation,
        isPrerendering : () => prerendering,
        wasDiscarded : () => options.wasDiscarded === true,
        hiddenTimes : () => options.hiddenTimes ?? [],
        onActivation(listener) {
            activationListeners.add(listener);
            return () => activationListeners.delete(listener);
        },
        setPrerendering(value) { prerendering = value; },
        setNavigation(value) { navigation = value; },
        activate() {
            prerendering = false;
            for (const listener of [...activationListeners]) listener();
        },
    };
}

/** An Event Timing entry for one interaction. */
export function eventEntry(fields : {
    interactionId : number;
    startTime : number;
    duration : number;
    name? : string;
    processingStart? : number;
    processingEnd? : number;
    target? : unknown;
}) : PerformanceEntryLike {
    return {
        entryType : "event",
        name : fields.name ?? "pointerdown",
        startTime : fields.startTime,
        duration : fields.duration,
        processingStart : fields.processingStart ?? fields.startTime + 2,
        processingEnd : fields.processingEnd ?? fields.startTime + 4,
        interactionId : fields.interactionId,
        ...(fields.target === undefined ? {} : { target : fields.target }),
    } as PerformanceEntryLike;
}

export function shiftEntry(startTime : number, value : number, hadRecentInput = false, node? : unknown) : PerformanceEntryLike {
    return {
        entryType : "layout-shift",
        name : "",
        startTime,
        duration : 0,
        value,
        hadRecentInput,
        sources : node === undefined ? [] : [{ node }],
    } as PerformanceEntryLike;
}

export function paintEntry(startTime : number) : PerformanceEntryLike {
    return { entryType : "paint", name : "first-contentful-paint", startTime, duration : 0 };
}

export function lcpEntry(startTime : number, element? : unknown, url? : string) : PerformanceEntryLike {
    return {
        entryType : "largest-contentful-paint",
        name : "",
        startTime,
        duration : 0,
        ...(element === undefined ? {} : { element }),
        ...(url === undefined ? {} : { url }),
    } as PerformanceEntryLike;
}
