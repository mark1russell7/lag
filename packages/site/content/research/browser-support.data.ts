/**
 * The browser support matrix of the research note "Browser support", for
 * `<SupportMatrix>`.
 *
 * The data shows the state on 2026-10-07: Chrome 155, Firefox 157 and
 * Safari 27. The versions come from MDN browser-compat-data 8.1.4, from
 * ChromeStatus, from the release notes and from the bug trackers. A cell
 * that the research did not verify, or for which the research gives no
 * value, has the status "unknown".
 */
import type { SupportBrowser, SupportCell, SupportFootnote, SupportRow, SupportStatus } from "../../src/components/SupportMatrix/types";

/**
 * The columns of each table. Chrome and Edge share one column, because Edge
 * has the Chromium version of Chrome. The last column shows the support in
 * workers.
 */
export const supportColumns : readonly SupportBrowser[] = [
    { id : "chromium", label : "Chrome and Edge" },
    { id : "firefox", label : "Firefox" },
    { id : "safari", label : "Safari" },
    { id : "worker", label : "In workers" },
];

/** The text of each note. Each table numbers the notes that it uses. */
const NOTES : Readonly<Record<string, string>> = {
    "na" : "The feature applies to documents only.",
    "positive" : "Mozilla has a positive position, but Firefox does not have the feature.",
    "oppose" : "The standards position of WebKit is against the feature.",
    "negative" : "The standards position of the engine is negative.",
    "loaf-fields" : "Chrome 145 added paintTime and presentationTime. The style and layout durations were an origin trial in Chrome 148 to 153. Their intent to ship for Chrome 157 got approval in October 2026.",
    "loaf-firefox" : "Mozilla has a positive position. Bug 1348405 is open (NEW, P3).",
    "loaf-worker" : "A proposal for dedicated workers targets 2027.",
    "longtask-worker" : "A proposal of October 2024 has no milestones.",
    "event-chrome" : "ChromeStatus gives 85 for the event entries. BCD gives 76 for the interface.",
    "count-firefox" : "BCD gives 144. The Firefox 144 release notes name only interactionId.",
    "target-chrome" : "Chrome has an experiment behind a flag. Chrome 148 updated it.",
    "target-safari" : "WebKit bug 301597 is open.",
    "fp" : "First Paint is only in Chromium, from Chrome 60.",
    "paint-chrome" : "Chrome has them on paint, LCP, element and LoAF entries, but not on Event Timing entries.",
    "paint-firefox" : "Firefox has them on paint and LCP entries. The LCP presentationTime is always null. The presentationTime of paint entries is not verified.",
    "paint-safari" : "Safari has paintTime on LCP entries only. Its presentationTime is always null.",
    "container-chrome" : "Chrome has it behind a flag from version 145 (BCD). An origin trial ran in Chrome 148 to 153, with no ship milestone.",
    "container-firefox" : "Firefox 156 has it behind the preference dom.enable_container_timing.",
    "cls-chrome" : "The sources array came in Chrome 84. Attribution rectangles are in CSS pixels from Chrome 145.",
    "softnav-chrome" : "The feature is on desktop, Android and WebView, but not on iOS.",
    "speculation-safari" : "Safari 26.2 has prefetch only, behind a feature flag.",
    "nrr-chrome" : "Chrome 123 started a gradual rollout. BCD gives 125.",
    "lifecycle-edge" : "Edge has the feature from version 79.",
    "pressure-chrome" : "The feature is on desktop only. ownContributionEstimate did not ship.",
    "pressure-worker" : "Dedicated workers and shared workers have it.",
    "isolated" : "The page must be cross-origin isolated.",
    "memory-worker" : "The specification exposes it in Window, SharedWorker and ServiceWorker. The measurement of a page includes its dedicated workers.",
    "legacy" : "The API is not standard and is deprecated. MDN calls its values unreliable.",
    "ric-safari" : "Only Safari Technology Preview has it, behind a flag. WebKit bug 285049 is open.",
    "window-only" : "Only Window has it.",
    "input-pending" : "Chrome 153 has it, but the Chrome documentation does not recommend it.",
    "device-memory" : "The values changed in Chrome 147.",
    "device-memory-worker" : "Chrome workers have it from version 65.",
    "concurrency-safari" : "The value is clamped to 4 or 8.",
    "chrome-worker" : "Chrome workers have it.",
    "idle-chrome" : "A permission is necessary. Edge had it in versions 94 and 95, and again from 114.",
    "dedicated" : "Dedicated workers have it.",
    "sab-chrome" : "Chrome on desktop needs cross-origin isolation from version 92. Earlier versions did not need it. Chrome for Android has it from 88 (Chrome blog) or 89 (BCD).",
    "desktop" : "The feature is on desktop only.",
    "credentialless-safari" : "WebKit supports the feature, but Safari does not have it.",
    "dip-chrome" : "Chrome has it on desktop from version 137 and on Android from 146.",
    "wait-chrome" : "In Chrome 87 to 89, the wait did not time out.",
    "observer-worker" : "Chrome workers have it from version 84, and Firefox workers have it. Safari workers do not have it.",
    "no-worker" : "Workers do not have it.",
    "intervention" : "Only Chrome has it. MDN and BCD mark the report body as deprecated.",
    "crash-chrome" : "JavaScript stacks for unresponsive pages came in Chrome 137. is_top_level and visibility_state came in 138, and the crash-reporting endpoint in 139.",
    "endpoint" : "The reports go to an endpoint. ReportingObserver cannot see them.",
    "policy-chrome" : "Each feature adds its own configuration point.",
    "policy-worker" : "Approval for dedicated workers is from approximately Chrome 147. This fact is not verified.",
    "profiler-chrome" : "The response header Document-Policy: js-profiling is necessary.",
    "profiler-worker" : "Support for dedicated workers is in development behind a flag. Chrome 153 workers do not have it.",
    "origin-worker" : "Each worker has its own time origin.",
    "types-worker" : "Workers have a different list of entry types.",
    "types-lists" : "The entry-type lists of Firefox and Safari come from BCD. The research did not test them.",
    "secure" : "Only secure contexts have it.",
};

function cell(status : SupportStatus, version : string | undefined, notes : readonly string[]) : SupportCell {
    return {
        status,
        ...(version === undefined ? {} : { version }),
        ...(notes.length === 0 ? {} : { notes }),
    };
}

/** The stable version has the feature, from `version`. */
const yes = (version? : string, ...notes : string[]) : SupportCell => cell("supported", version, notes);
/** The browser has the feature, with limits. */
const part = (version? : string, ...notes : string[]) : SupportCell => cell("partial", version, notes);
/** The stable version does not have the feature. */
const no = (...notes : string[]) : SupportCell => cell("unsupported", undefined, notes);
/** Not verified, or the research gives no value. */
const unknown = (...notes : string[]) : SupportCell => cell("unknown", undefined, notes);

/** The notes that `rows` use, in the sequence of their first use. */
function notesFor(rows : readonly SupportRow[]) : SupportFootnote[] {
    const used : string[] = [];
    for (const row of rows) {
        for (const column of supportColumns) {
            for (const id of row.cells[column.id]?.notes ?? []) {
                if (!used.includes(id)) used.push(id);
            }
        }
    }
    return used.map((id) => {
        const text = NOTES[id];
        if (text === undefined) throw new Error(`The support matrix has no note with the ID "${id}".`);
        return { id, text };
    });
}

export const frameRows : readonly SupportRow[] = [
    {
        feature : "Long Animation Frames",
        api : "long-animation-frame",
        cells : { chromium : yes("123", "loaf-fields"), firefox : no("loaf-firefox"), safari : no(), worker : no("loaf-worker") },
    },
    {
        feature : "Long Tasks",
        api : "longtask",
        cells : { chromium : yes("58"), firefox : no(), safari : no(), worker : no("longtask-worker") },
    },
];

export const interactionRows : readonly SupportRow[] = [
    {
        feature : "Event Timing",
        api : "event, durationThreshold, eventCounts",
        cells : { chromium : yes("85", "event-chrome"), firefox : yes("89"), safari : yes("26.2"), worker : no() },
    },
    {
        feature : "First input",
        api : "first-input",
        cells : { chromium : yes("77"), firefox : yes("89"), safari : yes("26.2"), worker : no() },
    },
    {
        feature : "Interaction IDs",
        api : "PerformanceEventTiming.interactionId",
        cells : { chromium : yes("96"), firefox : yes("144"), safari : yes("26.2"), worker : no() },
    },
    {
        feature : "Interaction count",
        api : "performance.interactionCount",
        cells : { chromium : yes("144"), firefox : yes("144", "count-firefox"), safari : yes("26.2"), worker : no() },
    },
    {
        feature : "Target selector",
        api : "PerformanceEventTiming.targetSelector",
        cells : { chromium : no("target-chrome"), firefox : no(), safari : no("target-safari"), worker : no() },
    },
];

export const paintRows : readonly SupportRow[] = [
    {
        feature : "Largest Contentful Paint",
        api : "largest-contentful-paint",
        cells : { chromium : yes("77"), firefox : yes("122"), safari : yes("26.2"), worker : no() },
    },
    {
        feature : "First Contentful Paint",
        api : "paint: first-contentful-paint",
        cells : { chromium : yes("60", "fp"), firefox : yes("84"), safari : yes("14.1"), worker : no() },
    },
    {
        feature : "Paint timestamps",
        api : "paintTime, presentationTime",
        cells : { chromium : yes("145", "paint-chrome"), firefox : part("140", "paint-firefox"), safari : part("26.2", "paint-safari"), worker : no() },
    },
    {
        feature : "Element Timing",
        api : "element",
        cells : { chromium : yes("77"), firefox : no("positive"), safari : no(), worker : no() },
    },
    {
        feature : "Container Timing",
        api : "container",
        cells : { chromium : no("container-chrome"), firefox : no("container-firefox"), safari : no(), worker : no() },
    },
    {
        feature : "Layout Instability",
        api : "layout-shift",
        cells : { chromium : yes("77", "cls-chrome"), firefox : no("positive"), safari : no(), worker : no() },
    },
];

export const navigationRows : readonly SupportRow[] = [
    {
        feature : "Soft navigations",
        api : "soft-navigation, interaction-contentful-paint, navigationId",
        cells : { chromium : yes("151", "softnav-chrome"), firefox : no(), safari : no(), worker : no() },
    },
    {
        feature : "Visibility-state entries",
        api : "visibility-state",
        cells : { chromium : yes("115"), firefox : no(), safari : no(), worker : no() },
    },
    {
        feature : "Prerender",
        api : "activationStart, document.prerendering, prerenderingchange",
        cells : { chromium : yes("108"), firefox : no(), safari : no(), worker : no("na") },
    },
    {
        feature : "Speculation Rules",
        api : "<script type=\"speculationrules\">",
        cells : { chromium : yes("109"), firefox : no(), safari : no("speculation-safari"), worker : no("na") },
    },
    {
        feature : "Back/forward cache events",
        api : "pageshow, pagehide, persisted",
        cells : { chromium : yes(), firefox : yes(), safari : yes(), worker : no("na") },
    },
    {
        feature : "Not-restored reasons",
        api : "notRestoredReasons",
        cells : { chromium : yes("123", "nrr-chrome"), firefox : no("positive"), safari : no(), worker : no("na") },
    },
    {
        feature : "Page Lifecycle",
        api : "freeze, resume, document.wasDiscarded",
        cells : { chromium : yes("68", "lifecycle-edge"), firefox : no(), safari : no(), worker : no("na") },
    },
    {
        feature : "Navigation API",
        api : "navigation",
        cells : { chromium : yes("102"), firefox : yes("147"), safari : yes("26.2"), worker : no() },
    },
    {
        feature : "Navigation confidence",
        api : "PerformanceNavigationTiming.confidence",
        cells : { chromium : yes("145"), firefox : no(), safari : no(), worker : no("na") },
    },
    {
        feature : "Deferred beacon",
        api : "fetchLater()",
        cells : { chromium : yes("135"), firefox : no("positive"), safari : no(), worker : no("window-only") },
    },
];

export const schedulingRows : readonly SupportRow[] = [
    {
        feature : "Idle callbacks",
        api : "requestIdleCallback",
        cells : { chromium : yes("47"), firefox : yes("55"), safari : no("ric-safari"), worker : no("window-only") },
    },
    {
        feature : "Task scheduling",
        api : "scheduler.postTask()",
        cells : { chromium : yes("94"), firefox : yes("142"), safari : no(), worker : yes() },
    },
    {
        feature : "Yield",
        api : "scheduler.yield()",
        cells : { chromium : yes("129"), firefox : yes("142"), safari : no(), worker : yes() },
    },
    {
        feature : "Pending input",
        api : "navigator.scheduling.isInputPending()",
        cells : { chromium : yes("87", "input-pending"), firefox : no(), safari : no(), worker : no() },
    },
    {
        feature : "Compute Pressure",
        api : "PressureObserver",
        cells : { chromium : part("125", "pressure-chrome"), firefox : no(), safari : no("oppose"), worker : yes(undefined, "pressure-worker") },
    },
    {
        feature : "Memory measurement",
        api : "performance.measureUserAgentSpecificMemory()",
        cells : { chromium : yes("89", "isolated"), firefox : no(), safari : no(), worker : part(undefined, "memory-worker") },
    },
    {
        feature : "Legacy memory API",
        api : "performance.memory",
        cells : { chromium : part(undefined, "legacy"), firefox : no(), safari : no(), worker : unknown() },
    },
    {
        feature : "Weak references",
        api : "WeakRef, FinalizationRegistry",
        cells : { chromium : yes("84"), firefox : yes("79"), safari : yes("14.1"), worker : yes() },
    },
    {
        feature : "Device memory",
        api : "navigator.deviceMemory",
        cells : { chromium : yes("63", "device-memory"), firefox : no(), safari : no("oppose"), worker : yes(undefined, "device-memory-worker") },
    },
    {
        feature : "Hardware concurrency",
        api : "navigator.hardwareConcurrency",
        cells : { chromium : yes("37"), firefox : yes("48"), safari : part("15.4", "concurrency-safari"), worker : yes() },
    },
    {
        feature : "Network Information",
        api : "navigator.connection.effectiveType",
        cells : { chromium : yes("61"), firefox : no("negative"), safari : no(), worker : yes(undefined, "chrome-worker") },
    },
    {
        feature : "CPU Performance",
        api : "navigator.cpuPerformance",
        cells : { chromium : yes("152"), firefox : no(), safari : no("oppose"), worker : no("window-only") },
    },
    {
        feature : "Idle Detection",
        api : "IdleDetector",
        cells : { chromium : yes("94", "idle-chrome"), firefox : no("negative"), safari : no("negative"), worker : yes(undefined, "dedicated") },
    },
];

export const isolationRows : readonly SupportRow[] = [
    {
        feature : "Shared memory",
        api : "SharedArrayBuffer",
        cells : { chromium : yes("92", "sab-chrome", "isolated"), firefox : yes("79", "isolated"), safari : yes("15.2", "isolated"), worker : yes() },
    },
    {
        feature : "Credentialless embedder policy",
        api : "Cross-Origin-Embedder-Policy: credentialless",
        cells : { chromium : yes("96"), firefox : part("119", "desktop"), safari : no("credentialless-safari"), worker : unknown() },
    },
    {
        feature : "Document isolation policy",
        api : "Document-Isolation-Policy",
        cells : { chromium : yes("137", "dip-chrome"), firefox : no("positive"), safari : no("negative"), worker : unknown() },
    },
    {
        feature : "Asynchronous wait",
        api : "Atomics.waitAsync()",
        cells : { chromium : yes("90", "wait-chrome"), firefox : yes("145"), safari : yes("16.4"), worker : yes() },
    },
    {
        feature : "Reporting observer",
        api : "ReportingObserver",
        cells : { chromium : yes("69"), firefox : yes("149"), safari : yes("16.4"), worker : part(undefined, "observer-worker") },
    },
    {
        feature : "Deprecation reports",
        api : "ReportingObserver: deprecation",
        cells : { chromium : yes("69"), firefox : yes("149", "no-worker"), safari : no(), worker : unknown() },
    },
    {
        feature : "Intervention reports",
        api : "ReportingObserver: intervention",
        cells : { chromium : yes("69", "intervention"), firefox : no(), safari : no(), worker : unknown() },
    },
    {
        feature : "Reporting endpoints",
        api : "Reporting-Endpoints",
        cells : { chromium : yes("96"), firefox : yes("130"), safari : yes("16.4"), worker : no("na") },
    },
    {
        feature : "Crash reports",
        api : "crash: oom, unresponsive",
        cells : { chromium : yes(undefined, "crash-chrome", "endpoint"), firefox : no("positive"), safari : no(), worker : no("na") },
    },
    {
        feature : "Crash report context",
        api : "window.crashReport",
        cells : { chromium : yes("145"), firefox : no(), safari : no(), worker : no("na") },
    },
    {
        feature : "Document Policy",
        api : "Document-Policy",
        cells : { chromium : yes(undefined, "policy-chrome"), firefox : no(), safari : no(), worker : unknown("policy-worker") },
    },
    {
        feature : "JS Self-Profiling",
        api : "Profiler",
        cells : { chromium : yes("94", "profiler-chrome"), firefox : no(), safari : no(), worker : no("profiler-worker") },
    },
];

export const timeRows : readonly SupportRow[] = [
    {
        feature : "Time origin",
        api : "performance.timeOrigin",
        cells : { chromium : yes("62"), firefox : yes("53"), safari : yes("15"), worker : yes(undefined, "origin-worker") },
    },
    {
        feature : "Monotonic clock in workers",
        api : "performance.now()",
        cells : { chromium : yes("30"), firefox : yes("34"), safari : yes("11"), worker : yes() },
    },
    {
        feature : "Observers in workers",
        api : "PerformanceObserver",
        cells : { chromium : yes("62"), firefox : yes("57"), safari : yes("11"), worker : yes() },
    },
    {
        feature : "Supported entry types",
        api : "PerformanceObserver.supportedEntryTypes",
        cells : { chromium : yes("73"), firefox : yes("68", "types-lists"), safari : yes("13", "types-lists"), worker : yes(undefined, "types-worker") },
    },
    {
        feature : "Server timing",
        api : "serverTiming",
        cells : { chromium : yes("65", "secure"), firefox : yes("61", "secure"), safari : yes("16.4", "secure"), worker : yes() },
    },
];

export const frameNotes : readonly SupportFootnote[] = notesFor(frameRows);
export const interactionNotes : readonly SupportFootnote[] = notesFor(interactionRows);
export const paintNotes : readonly SupportFootnote[] = notesFor(paintRows);
export const navigationNotes : readonly SupportFootnote[] = notesFor(navigationRows);
export const schedulingNotes : readonly SupportFootnote[] = notesFor(schedulingRows);
export const isolationNotes : readonly SupportFootnote[] = notesFor(isolationRows);
export const timeNotes : readonly SupportFootnote[] = notesFor(timeRows);
