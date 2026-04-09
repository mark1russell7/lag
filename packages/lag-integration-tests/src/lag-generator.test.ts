import { expect } from "vitest";
import {
    createRng,
    constant,
    uniform,
    normal,
    exponential,
    powerLaw,
    bimodal,
    evolutionary,
    burst,
    sample,
} from "./lag-generator/index.js";

describe("lag-generator: RNG", () => {
    it("is reproducible given the same seed", () => {
        const a = createRng(42);
        const b = createRng(42);
        const seqA = [a.next(), a.next(), a.next(), a.next()];
        const seqB = [b.next(), b.next(), b.next(), b.next()];
        expect(seqA).toEqual(seqB);
    });

    it("produces different sequences for different seeds", () => {
        const a = createRng(1);
        const b = createRng(2);
        expect(a.next()).not.toBe(b.next());
    });

    it("int() respects bounds inclusively", () => {
        const rng = createRng(123);
        for (let i = 0; i < 100; i++) {
            const v = rng.int(5, 10);
            expect(v).toBeGreaterThanOrEqual(5);
            expect(v).toBeLessThanOrEqual(10);
        }
    });

    it("range() respects bounds (half-open)", () => {
        const rng = createRng(123);
        for (let i = 0; i < 100; i++) {
            const v = rng.range(2, 8);
            expect(v).toBeGreaterThanOrEqual(2);
            expect(v).toBeLessThan(8);
        }
    });

    it("normal() produces values approximately centered at 0", () => {
        const rng = createRng(42);
        const samples : number[] = [];
        for (let i = 0; i < 5000; i++) samples.push(rng.normal());
        const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
        // Mean of N(0,1) over 5000 samples should be very close to 0
        expect(Math.abs(mean)).toBeLessThan(0.1);
    });

    it("bool(p) approximates the requested probability", () => {
        const rng = createRng(42);
        let trues = 0;
        const N = 5000;
        for (let i = 0; i < N; i++) if (rng.bool(0.3)) trues++;
        // Expect ~1500 ± noise
        expect(trues).toBeGreaterThan(N * 0.27);
        expect(trues).toBeLessThan(N * 0.33);
    });

    it("pick() selects from the array uniformly", () => {
        const rng = createRng(42);
        const counts = { a : 0, b : 0, c : 0 };
        for (let i = 0; i < 3000; i++) {
            const k = rng.pick(["a", "b", "c"] as const);
            counts[k]++;
        }
        // Each should be ~1000
        expect(counts.a).toBeGreaterThan(800);
        expect(counts.b).toBeGreaterThan(800);
        expect(counts.c).toBeGreaterThan(800);
    });
});

describe("lag-generator: Distributions", () => {
    it("constant always returns the same value", () => {
        const rng = createRng(42);
        const d = constant(7);
        for (let i = 0; i < 10; i++) expect(d(rng)).toBe(7);
    });

    it("uniform stays in bounds", () => {
        const rng = createRng(42);
        const d = uniform(10, 20);
        for (let i = 0; i < 1000; i++) {
            const v = d(rng);
            expect(v).toBeGreaterThanOrEqual(10);
            expect(v).toBeLessThan(20);
        }
    });

    it("normal clamps to [min, max]", () => {
        const rng = createRng(42);
        const d = normal(50, 30, 0, 100);
        for (let i = 0; i < 1000; i++) {
            const v = d(rng);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(100);
        }
    });

    it("exponential is non-negative and skewed", () => {
        const rng = createRng(42);
        const d = exponential(1 / 50); // mean 50
        const samples = sample(d, 5000, rng);
        const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
        expect(mean).toBeGreaterThan(40);
        expect(mean).toBeLessThan(60);
        // Skew: median should be < mean for exponential
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        expect(median).toBeLessThan(mean);
    });

    it("powerLaw produces a long tail", () => {
        const rng = createRng(42);
        const d = powerLaw(10, 1.5, 10000);
        const samples = sample(d, 5000, rng);
        const max = Math.max(...samples);
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        // Long tail: max should be much larger than median
        expect(max).toBeGreaterThan(median * 10);
        // All values should be >= xMin
        expect(Math.min(...samples)).toBeGreaterThanOrEqual(10);
    });

    it("bimodal produces two clusters", () => {
        const rng = createRng(42);
        const d = bimodal(0.8, constant(10), constant(100));
        let smalls = 0;
        let larges = 0;
        for (let i = 0; i < 1000; i++) {
            const v = d(rng);
            if (v === 10) smalls++;
            else if (v === 100) larges++;
        }
        // 80/20 split
        expect(smalls).toBeGreaterThan(700);
        expect(larges).toBeGreaterThan(150);
    });

    it("evolutionary drifts as a random walk", () => {
        const rng = createRng(42);
        // Large step size, no upper clamp — should drift noticeably
        const d = evolutionary(0, 5, -Infinity, Infinity);
        const samples = sample(d, 100, rng);
        // Successive samples should differ (random walk)
        let differences = 0;
        for (let i = 1; i < samples.length; i++) {
            if (samples[i] !== samples[i - 1]) differences++;
        }
        expect(differences).toBeGreaterThan(90);
    });

    it("burst alternates between active and idle", () => {
        const rng = createRng(42);
        const d = burst(3, 2, constant(50));
        const seq = sample(d, 10, rng);
        // 3 on, 2 off, 3 on, 2 off
        expect(seq).toEqual([50, 50, 50, 0, 0, 50, 50, 50, 0, 0]);
    });
});
