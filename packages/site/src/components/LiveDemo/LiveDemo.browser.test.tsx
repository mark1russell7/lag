import "../../styles/global.css";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoFocus } from "../../adapters/lag-core";
import { browserSessionFactory } from "../../app/default-services";
import { sessionsWithoutStart } from "../../app/prerender-sessions";
import type { SessionFactory } from "../../playground/SessionFactoryContext";
import { SessionFactoryProvider } from "../../playground/SessionFactoryContext";
import LiveDemo from "./LiveDemo";

let container : HTMLDivElement;
let root : Root;

beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "640px";
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    root.unmount();
    container.remove();
});

function render(element : ReactNode, factory : SessionFactory = browserSessionFactory) : void {
    const router = createMemoryRouter([{ path : "/", element : <SessionFactoryProvider factory={factory}>{element}</SessionFactoryProvider> }]);
    root.render(<RouterProvider router={router} />);
}

function value(label : string) : string | undefined {
    const term = [...container.querySelectorAll("dt")].find(candidate => candidate.textContent === label);
    return term?.nextElementSibling?.textContent ?? undefined;
}

function button(text : string) : HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(candidate => candidate.textContent === text);
    if (!found) throw new Error(`No button "${text}"`);
    return found;
}

describe("LiveDemo", () => {
    it("starts DriftLag when it comes into view, and records a block as lag", async () => {
        render(<LiveDemo monitor="drift-lag" />);
        await vi.waitFor(() => expect(container.textContent).toContain("The monitor operates in this tab"), { timeout : 15_000 });
        await vi.waitFor(() => expect(button("Block for 200 ms").disabled).toBe(false));
        const before = Number.parseFloat(value("Blocked time (sum)") ?? "0");
        button("Block for 200 ms").click();
        await vi.waitFor(() => {
            const after = value("Blocked time (sum)") ?? "";
            // The sum shows in ms below 1 s, and in s from 1 s
            const ms = after.endsWith(" s") ? Number.parseFloat(after) * 1_000 : Number.parseFloat(after);
            expect(ms - before).toBeGreaterThanOrEqual(150);
        }, { timeout : 15_000 });
        button("Stop the demo").click();
        await vi.waitFor(() => expect(container.textContent).toContain("The monitor is stopped."));
        expect(button("Start again")).toBeDefined();
    });

    it.each<DemoFocus>(["frame-timing", "worker-lag", "lifecycle", "gc-signal", "event-timing"])("starts the demo of %s without errors", async (monitor) => {
        const errors : string[] = [];
        vi.spyOn(console, "error").mockImplementation((...args : unknown[]) => { errors.push(args.map(String).join(" ")); });
        render(<LiveDemo monitor={monitor} />);
        await vi.waitFor(() => expect(container.textContent).toContain("The monitor operates in this tab"), { timeout : 15_000 });
        expect(container.textContent).not.toMatch(/monitor did not|did not (?:render|load)/);
        expect(errors).toEqual([]);
        vi.restoreAllMocks();
    });

    it("shows the transitions of the lifecycle demo", async () => {
        render(<LiveDemo monitor="lifecycle" />);
        await vi.waitFor(() => expect(container.textContent).toContain("The monitor operates in this tab"), { timeout : 15_000 });
        expect(container.textContent).toContain("State of this tab");
        expect(container.querySelector("table caption")?.textContent).toBe("The newest transitions");
    });

    it("does not start in the prerender of the build", async () => {
        render(<LiveDemo monitor="drift-lag" />, sessionsWithoutStart(browserSessionFactory));
        await vi.waitFor(() => expect(button("Start the demo").disabled).toBe(false), { timeout : 15_000 });
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(container.textContent).toContain("The demo starts when it comes into view.");
        expect(value("Windows")).toBe("0");
    });
});
