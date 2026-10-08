import { expect } from "vitest";
import { LifecycleStateMachine, type StateTransition } from "@lag/core";

/**
 * The lifecycle in a real browser. This file has its own page, thus the
 * synthetic lifecycle events here do not change the state of other tests.
 */
describe("LifecycleStateMachine in a browser", () => {
    it("notifies its subscribers before a document listener that the page added earlier", () => {
        const order : string[] = [];
        // For example, an OpenTelemetry exporter that flushes when the page changes state
        const exporterFlush = () => order.push("exporter flush");
        document.addEventListener("freeze", exporterFlush);
        const lifecycle = new LifecycleStateMachine(document, window, performance, { log : () => {} });
        lifecycle.subscribe(() => order.push("subscriber"));

        try {
            document.dispatchEvent(new Event("freeze"));
        } finally {
            lifecycle.dispose();
            document.removeEventListener("freeze", exporterFlush);
        }

        // At the target, capture listeners go first. Chromium does not do this
        // when the target is `window` (pagehide, pageshow): AllMonitorHandles.flush()
        // is the hook for that case.
        expect(order).toEqual(["subscriber", "exporter flush"]);
    });

    it("uses the time of the event for the transition", () => {
        const transitions : StateTransition[] = [];
        const lifecycle = new LifecycleStateMachine(document, window, performance, { log : () => {} });
        lifecycle.subscribe(t => transitions.push(t));

        const event = new PageTransitionEvent("pagehide", { persisted : true });
        try {
            window.dispatchEvent(event);
        } finally {
            lifecycle.dispose();
        }

        expect(transitions).toEqual([expect.objectContaining({ to : "frozen", trigger : "pagehide", timestamp : event.timeStamp })]);
        expect(event.timeStamp).toBeLessThanOrEqual(performance.now());
    });

    it("removes every listener when it is disposed", () => {
        const order : string[] = [];
        const lifecycle = new LifecycleStateMachine(document, window, performance, { log : () => {} });
        lifecycle.subscribe(() => order.push("subscriber"));
        lifecycle.dispose();

        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted : true }));
        document.dispatchEvent(new Event("freeze"));
        expect(order).toEqual([]);
    });
});
