import { vi, expect } from "vitest";
import { MonitorRegistry } from "./monitor-registry.js";
import type { MonitorHandle } from "./monitor-handle.js";

function makeHandle<T = unknown>(
    name : string,
    monitor : T | undefined = {} as T,
    stopImpl : () => void = () => {},
) : MonitorHandle<T> {
    return { name, monitor, stop : stopImpl };
}

describe("MonitorRegistry", () => {
    it("adds handles and returns them unchanged", () => {
        const r = new MonitorRegistry();
        const h = makeHandle("a");
        expect(r.add(h)).toBe(h);
        expect(r.size).toBe(1);
    });

    it("looks up handles by name", () => {
        const r = new MonitorRegistry();
        const a = makeHandle("a", { kind : "a" });
        const b = makeHandle("b", { kind : "b" });
        r.add(a);
        r.add(b);
        expect(r.get("a")).toBe(a);
        expect(r.get("b")).toBe(b);
        expect(r.get("nope")).toBeUndefined();
    });

    it("stopAll() calls stop on every handle in LIFO order", () => {
        const r = new MonitorRegistry();
        const order : string[] = [];
        r.add(makeHandle("a", null, () => order.push("a")));
        r.add(makeHandle("b", null, () => order.push("b")));
        r.add(makeHandle("c", null, () => order.push("c")));
        r.stopAll();
        expect(order).toEqual(["c", "b", "a"]);
    });

    it("stopAll() isolates errors — one bad stop doesn't prevent others", () => {
        const r = new MonitorRegistry();
        const goodStop1 = vi.fn();
        const goodStop2 = vi.fn();
        const badStop = vi.fn(() => { throw new Error("boom"); });
        r.add(makeHandle("a", null, goodStop1));
        r.add(makeHandle("b", null, badStop));
        r.add(makeHandle("c", null, goodStop2));

        expect(() => r.stopAll()).not.toThrow();
        expect(goodStop1).toHaveBeenCalled();
        expect(goodStop2).toHaveBeenCalled();
        expect(badStop).toHaveBeenCalled();
    });

    it("stopAll() clears the registry", () => {
        const r = new MonitorRegistry();
        r.add(makeHandle("a"));
        r.add(makeHandle("b"));
        expect(r.size).toBe(2);
        r.stopAll();
        expect(r.size).toBe(0);
    });

    it("getAll() returns all handles in registration order", () => {
        const r = new MonitorRegistry();
        const a = makeHandle("a");
        const b = makeHandle("b");
        r.add(a);
        r.add(b);
        expect(r.getAll()).toEqual([a, b]);
    });
});
