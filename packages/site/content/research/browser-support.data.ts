/**
 * Browser support of the APIs that the monitors use, for `<SupportMatrix>`.
 *
 * DRAFT: an author must verify every cell against the browser release notes
 * and MDN before the page is final. A cell that is not verified is "unknown".
 */
import type { SupportFootnote, SupportRow } from "../../src/components/SupportMatrix/types";

export const apiSupport : readonly SupportRow[] = [
    {
        feature : "Long Animation Frames",
        api : "PerformanceObserver: long-animation-frame",
        cells : {
            chrome : { status : "supported", version : "123" },
            edge : { status : "supported", version : "123" },
            firefox : { status : "unsupported" },
            safari : { status : "unsupported" },
        },
    },
    {
        feature : "Event Timing (INP)",
        api : "PerformanceObserver: event",
        cells : {
            chrome : { status : "supported", version : "76" },
            edge : { status : "supported", version : "79" },
            firefox : { status : "unknown", notes : ["verify"] },
            safari : { status : "unknown", notes : ["verify"] },
        },
    },
    {
        feature : "Layout Instability (CLS)",
        api : "PerformanceObserver: layout-shift",
        cells : {
            chrome : { status : "supported", version : "77" },
            edge : { status : "supported", version : "79" },
            firefox : { status : "unsupported" },
            safari : { status : "unsupported" },
        },
    },
    {
        feature : "Largest Contentful Paint",
        api : "PerformanceObserver: largest-contentful-paint",
        cells : {
            chrome : { status : "supported", version : "77" },
            edge : { status : "supported", version : "79" },
            firefox : { status : "unknown", notes : ["verify"] },
            safari : { status : "unknown", notes : ["verify"] },
        },
    },
    {
        feature : "Idle callbacks",
        api : "requestIdleCallback",
        cells : {
            chrome : { status : "supported", version : "47" },
            edge : { status : "supported", version : "79" },
            firefox : { status : "supported", version : "55" },
            safari : { status : "unknown", notes : ["verify"] },
        },
    },
    {
        feature : "Compute Pressure",
        api : "PressureObserver",
        cells : {
            chrome : { status : "supported", version : "125", notes : ["desktop"] },
            edge : { status : "supported", version : "125", notes : ["desktop"] },
            firefox : { status : "unsupported" },
            safari : { status : "unsupported" },
        },
    },
    {
        feature : "Memory measurement",
        api : "performance.measureUserAgentSpecificMemory()",
        cells : {
            chrome : { status : "supported", version : "89", notes : ["isolated"] },
            edge : { status : "supported", version : "89", notes : ["isolated"] },
            firefox : { status : "unsupported" },
            safari : { status : "unsupported" },
        },
    },
    {
        feature : "Legacy memory API",
        api : "performance.memory",
        cells : {
            chrome : { status : "partial", notes : ["legacy"] },
            edge : { status : "partial", notes : ["legacy"] },
            firefox : { status : "unsupported" },
            safari : { status : "unsupported" },
        },
    },
    {
        feature : "Garbage collection canary",
        api : "FinalizationRegistry",
        cells : {
            chrome : { status : "supported", version : "84" },
            edge : { status : "supported", version : "84" },
            firefox : { status : "supported", version : "79" },
            safari : { status : "supported", version : "14.1" },
        },
    },
    {
        feature : "Page Lifecycle freeze and resume",
        api : "document: freeze, resume",
        cells : {
            chrome : { status : "supported", version : "68" },
            edge : { status : "supported", version : "79" },
            firefox : { status : "unsupported" },
            safari : { status : "unsupported" },
        },
    },
];

export const apiSupportNotes : readonly SupportFootnote[] = [
    { id : "verify", text : "Not verified. Examine the release notes of the browser and MDN, then update this cell." },
    { id : "desktop", text : "Desktop versions only. Examine the support on Android before you use this value." },
    { id : "isolated", text : "Only in a cross-origin isolated page. Otherwise MemoryMonitor uses performance.memory." },
    { id : "legacy", text : "A non-standard API. The values are coarse, and the API can be removed." },
];
