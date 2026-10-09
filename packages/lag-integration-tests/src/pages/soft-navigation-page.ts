/**
 * A top-level page for `soft-navigation.test.ts`. Chrome detects soft
 * navigations only in the top-level frame, and the tests of Vitest operate in
 * a frame. Thus a server command opens this page, clicks its button, and
 * reads `finishProbe()`.
 *
 * The page operates all monitors with soft navigations. The click blocks the
 * main thread for 60 ms, changes the URL with `history.pushState`, and adds
 * the content of the next page.
 */
import { createBrowserDeps, setupAllMonitors, type Meter } from "@mark1russell7/lag";

/** The result of `finishProbe()`. */
export type SoftNavigationResult = {
    /** The type of each entry, in the sequence of delivery (the events of an interaction only). */
    entryOrder : string[];
    /** The attributes of each `browser.web_vital` event. */
    vitals : Array<Record<string, unknown>>;
    url : string;
};

const entryOrder : string[] = [];
for (const type of ["event", "soft-navigation", "interaction-contentful-paint"]) {
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (type === "event" && !(entry as PerformanceEntry & { interactionId? : number }).interactionId) continue;
            entryOrder.push(type === "event" ? `event:${entry.name}` : type);
        }
    }).observe({ type, buffered : true, ...(type === "event" ? { durationThreshold : 16 } : {}) } as PerformanceObserverInit);
}

const vitals : Array<Record<string, unknown>> = [];
/** This page cannot use the meters of the tests, because they need Vitest. */
const meter : Meter = {
    createHistogram : () => ({ record : () => {} }),
    createCounter : () => ({ add : () => {} }),
};
const handles = setupAllMonitors(createBrowserDeps(window as never, {
    logger : { log : () => {} },
    meter,
    events : { emit : (name, attributes) => { if (name === "browser.web_vital") vitals.push({ ...attributes }); } },
    softNavigations : true,
}));

document.getElementById("go")!.addEventListener("click", () => {
    const end = performance.now() + 60;
    while (performance.now() < end) {
        // busy wait
    }
    history.pushState({}, "", "next-page");
    const main = document.createElement("main");
    main.innerHTML = `<h1 style="font-size: 64px">The next page</h1><p style="font-size: 32px">${"The text of the next page. ".repeat(40)}</p>`;
    document.body.append(main);
});

const probe = window as unknown as { finishProbe : () => SoftNavigationResult; probeReady : boolean };
probe.finishProbe = () => {
    handles.stop();
    return { entryOrder, vitals, url : location.href };
};
probe.probeReady = true;
