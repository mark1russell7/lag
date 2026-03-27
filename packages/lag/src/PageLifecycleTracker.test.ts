import { vi, expect } from "vitest";
import { PageLifecycleTracker, type PageLifecycleDocument, type PageLifecycleWindow } from "./PageLifecycleTracker.js";

function createMocks() {
    const docListeners = new Map<string, (() => void)[]>();
    const winListeners = new Map<string, ((event? : any) => void)[]>();

    const mockDocument : PageLifecycleDocument = {
        visibilityState : "visible",
        addEventListener(event : string, callback : () => void) {
            if (!docListeners.has(event)) docListeners.set(event, []);
            docListeners.get(event)!.push(callback);
        },
    };

    const mockWindow : PageLifecycleWindow = {
        addEventListener(event : string, callback : (event? : any) => void) {
            if (!winListeners.has(event)) winListeners.set(event, []);
            winListeners.get(event)!.push(callback);
        },
    };

    const fireDocEvent = (event : string) =>
        docListeners.get(event)?.forEach(cb => cb());

    const fireWinEvent = (event : string, data? : any) =>
        winListeners.get(event)?.forEach(cb => cb(data));

    return { mockDocument, mockWindow, fireDocEvent, fireWinEvent };
}

describe("PageLifecycleTracker", () => {
    it("reports wasHidden when page becomes hidden", () => {
        const { mockDocument, mockWindow, fireDocEvent } = createMocks();
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        mockDocument.visibilityState = "hidden";
        fireDocEvent("visibilitychange");

        const state = tracker.getAndReset();
        expect(state.wasHidden).toBe(true);
        expect(state.wasFrozen).toBe(false);
        expect(state.wasRestored).toBe(false);
    });

    it("resets state after getAndReset", () => {
        const { mockDocument, mockWindow, fireDocEvent } = createMocks();
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        mockDocument.visibilityState = "hidden";
        fireDocEvent("visibilitychange");

        // Transition back to visible before consuming
        mockDocument.visibilityState = "visible";
        fireDocEvent("visibilitychange");

        const state1 = tracker.getAndReset();
        expect(state1.wasHidden).toBe(true); // was hidden at some point

        // Now that it's been visible since reset, should report false
        const state2 = tracker.getAndReset();
        expect(state2.wasHidden).toBe(false);
    });

    it("reports wasFrozen on freeze event", () => {
        const { mockDocument, mockWindow, fireDocEvent } = createMocks();
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        fireDocEvent("freeze");

        const state = tracker.getAndReset();
        expect(state.wasFrozen).toBe(true);
        expect(logger.log).toHaveBeenCalledWith(
            "info",
            "Page frozen.",
            expect.any(Object),
        );
    });

    it("reports wasRestored on pageshow with persisted=true", () => {
        const { mockDocument, mockWindow, fireWinEvent } = createMocks();
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        fireWinEvent("pageshow", { persisted : true });

        const state = tracker.getAndReset();
        expect(state.wasRestored).toBe(true);
        expect(logger.log).toHaveBeenCalledWith(
            "info",
            "Page restored from BFCache.",
            expect.any(Object),
        );
    });

    it("does not set wasRestored on pageshow with persisted=false", () => {
        const { mockDocument, mockWindow, fireWinEvent } = createMocks();
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        fireWinEvent("pageshow", { persisted : false });

        const state = tracker.getAndReset();
        expect(state.wasRestored).toBe(false);
    });

    it("detects hidden state at construction time", () => {
        const { mockDocument, mockWindow } = createMocks();
        mockDocument.visibilityState = "hidden";
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        const state = tracker.getAndReset();
        expect(state.wasHidden).toBe(true);
    });

    it("re-reads visibilityState after reset", () => {
        const { mockDocument, mockWindow } = createMocks();
        mockDocument.visibilityState = "hidden";
        const logger = { log : vi.fn() };

        const tracker = new PageLifecycleTracker(mockDocument, mockWindow, logger);

        // First getAndReset — should be hidden, and since doc is still hidden,
        // the post-reset update should re-capture it
        const state1 = tracker.getAndReset();
        expect(state1.wasHidden).toBe(true);

        const state2 = tracker.getAndReset();
        expect(state2.wasHidden).toBe(true); // still hidden
    });
});
