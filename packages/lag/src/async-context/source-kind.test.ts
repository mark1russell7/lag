import { describe, expect, it } from "vitest";
import { CALLBACK_SOURCE_KINDS, callbackSourceKind, type CallbackSourceKind } from "./source-kind.js";
import { METRICS } from "../metric-catalog.js";

/** The keys of a record, sorted. TypeScript makes sure that the record has each value of the union `T`, and no other value. */
const valuesOf = <T extends string>(values : Record<T, true>) : string[] => Object.keys(values).sort();

describe("callbackSourceKind", () => {
    it.each([
        ["await", "await"],
        ["Promise.then", "promise"],
        ["queueMicrotask", "promise"],
        ["setTimeout", "timer"],
        ["setInterval", "timer"],
        ["setImmediate", "timer"],
        ["requestIdleCallback", "timer"],
        ["Scheduler.postTask", "timer"],
        ["requestAnimationFrame", "frame"],
        ["XRSession.requestAnimationFrame", "frame"],
        ["HTMLVideoElement.requestVideoFrameCallback", "frame"],
        ["Document.startViewTransition", "frame"],
        ["NavigateEvent.intercept", "event"],
        ["LockManager.request", "lock"],
        ["MutationObserver", "observer"],
        ["WebKitMutationObserver", "observer"],
        ["ResizeObserver", "observer"],
        ["IntersectionObserver", "observer"],
        ["PerformanceObserver", "observer"],
        ["ReportingObserver", "observer"],
        ["PressureObserver", "observer"],
        ["FinalizationRegistry", "observer"],
    ])("gives the kind of the source %s: %s", (source, kind) => {
        expect(callbackSourceKind(source)).toBe(kind);
    });

    it.each([
        ["addEventListener:click", "event"],
        ["addEventListener:message", "event"],
        // MediaQueryList.addListener() uses addEventListener("change")
        ["addEventListener:change", "event"],
        // An event type of a custom event can have any characters
        ["addEventListener:my-event:done", "event"],
        ["onclick", "event"],
        ["onmessage", "event"],
        ["onreadystatechange", "event"],
        ["ReadableStream.start", "stream"],
        ["ReadableStream.pull", "stream"],
        ["WritableStream.write", "stream"],
        ["TransformStream.transform", "stream"],
        ["TransformStream.flush", "stream"],
    ])("gives the kind of the pattern of the source %s: %s", (source, kind) => {
        expect(callbackSourceKind(source)).toBe(kind);
    });

    it.each([
        "Geolocation.watchPosition",
        "HTMLCanvasElement.toBlob",
        "Array.fromAsync",
        "MediaSession.setActionHandler",
        "RTCPeerConnection.createOffer",
        // Not the library sources, and the properties of Object.prototype
        "",
        "constructor",
        "toString",
        "__proto__",
        "on",
        "onClick",
        "xonclick",
        "on-click",
        "onclick1",
        "onclick.call",
        "addEventListener",
        "xaddEventListener:click",
        "ReadableStream",
        "ReadableStream.",
        "XReadableStream.pull",
        "ReadableStream.pull.x",
        "DuplexStream.pull",
        "set Timeout",
        "setTimeout ",
    ])("gives other for the source %j", (source) => {
        expect(callbackSourceKind(source)).toBe("other");
    });

    it("gives only the values of the closed set", () => {
        const sources = ["await", "Promise.then", "setTimeout", "addEventListener:x", "onx", "ReadableStream.pull", "LockManager.request", "requestAnimationFrame", "MutationObserver", "x"];
        const kinds = new Set(sources.map(callbackSourceKind));
        expect([...kinds].sort()).toEqual([...CALLBACK_SOURCE_KINDS].sort());
    });
});

describe("CALLBACK_SOURCE_KINDS", () => {
    it("is the type CallbackSourceKind, and the attribute values of the histogram of long callbacks", () => {
        const kinds = valuesOf<CallbackSourceKind>({
            timer : true,
            promise : true,
            event : true,
            await : true,
            observer : true,
            stream : true,
            lock : true,
            frame : true,
            other : true,
        });
        expect([...CALLBACK_SOURCE_KINDS].sort()).toEqual(kinds);
        expect(METRICS.longCallbackDuration.attributes).toEqual({ source_kind : CALLBACK_SOURCE_KINDS });
    });
});
