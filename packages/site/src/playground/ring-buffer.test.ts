import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer";

describe("RingBuffer", () => {
    it("keeps the newest items when it is full", () => {
        const buffer = new RingBuffer<number>(3);
        for (const value of [1, 2, 3, 4, 5]) buffer.push(value);
        expect(buffer.size).toBe(3);
        expect(buffer.toArray()).toEqual([3, 4, 5]);
        expect(buffer.latest()).toBe(5);
    });

    it("returns the newest items that pass a test", () => {
        const buffer = new RingBuffer<number>(5);
        for (const value of [1, 5, 2, 6, 7]) buffer.push(value);
        expect(buffer.newest(value => value > 4)).toEqual([6, 7]);
        expect(buffer.newest(() => true)).toEqual([1, 5, 2, 6, 7]);
    });

    it("can be cleared", () => {
        const buffer = new RingBuffer<string>(2);
        buffer.push("a");
        buffer.clear();
        expect(buffer.size).toBe(0);
        expect(buffer.latest()).toBeUndefined();
        expect(buffer.toArray()).toEqual([]);
    });

    it("refuses a capacity that is not a positive integer", () => {
        expect(() => new RingBuffer(0)).toThrow(RangeError);
        expect(() => new RingBuffer(1.5)).toThrow(RangeError);
    });
});
