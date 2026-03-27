import { expect } from "vitest";
import { GCSpikeDetector } from "./GCSpikeDetector.js";

describe("GCSpikeDetector", () => {
    it("classifies normal values as not GC spikes", () => {
        const detector = new GCSpikeDetector();

        // Feed steady values
        for (let i = 0; i < 10; i++) {
            expect(detector.classify(5).likelyGCPause).toBe(false);
        }
    });

    it("classifies large spikes as likely GC pauses", () => {
        const detector = new GCSpikeDetector();

        // Build up baseline of ~5ms
        for (let i = 0; i < 20; i++) {
            detector.classify(5);
        }

        // 500ms spike (100x the median) — should be flagged
        const result = detector.classify(500);
        expect(result.likelyGCPause).toBe(true);
    });

    it("does not flag moderate increases", () => {
        const detector = new GCSpikeDetector();

        // Build up baseline of ~5ms
        for (let i = 0; i < 20; i++) {
            detector.classify(5);
        }

        // 30ms value (6x median, below 10x threshold)
        const result = detector.classify(30);
        expect(result.likelyGCPause).toBe(false);
    });

    it("handles zero median gracefully", () => {
        const detector = new GCSpikeDetector();

        // Feed zeros
        for (let i = 0; i < 10; i++) {
            detector.classify(0);
        }

        // Non-zero value with zero median should not be flagged (avoids division issue)
        const result = detector.classify(100);
        expect(result.likelyGCPause).toBe(false);
    });

    it("adapts as the window fills with new values", () => {
        const detector = new GCSpikeDetector(10, 10); // small window

        // Fill with 5s
        for (let i = 0; i < 10; i++) {
            detector.classify(5);
        }

        // Now fill with 50s
        for (let i = 0; i < 10; i++) {
            detector.classify(50);
        }

        // 500 should no longer be a spike (median is now 50, 500/50 = 10x exactly)
        // With our > check, exactly 10x should not trigger
        const result = detector.classify(500);
        expect(result.likelyGCPause).toBe(false);
    });

    it("resets internal state", () => {
        const detector = new GCSpikeDetector();

        for (let i = 0; i < 20; i++) {
            detector.classify(5);
        }

        detector.reset();

        // After reset, first value has no baseline — should not flag
        const result = detector.classify(500);
        expect(result.likelyGCPause).toBe(false);
    });

    it("uses custom spike multiplier", () => {
        const detector = new GCSpikeDetector(50, 5); // 5x multiplier

        for (let i = 0; i < 20; i++) {
            detector.classify(10);
        }

        // 60 is 6x median — above 5x threshold
        expect(detector.classify(60).likelyGCPause).toBe(true);

        // But 40 is 4x — below threshold
        detector.reset();
        for (let i = 0; i < 20; i++) {
            detector.classify(10);
        }
        expect(detector.classify(40).likelyGCPause).toBe(false);
    });
});
