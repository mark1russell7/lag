import "../../styles/global.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSessionFactory } from "../../app/default-services";
import { SessionFactoryProvider } from "../../playground/SessionFactoryContext";
import { HeroInstrument } from "./HeroInstrument";

(globalThis as { IS_REACT_ACT_ENVIRONMENT? : boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The session publishes 4 snapshots each second, and the machine can be busy with other tests
const patience = { timeout : 15_000, interval : 100 };

let container : HTMLDivElement;
let root : Root;

beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "560px";
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(
        <MemoryRouter>
            <SessionFactoryProvider factory={browserSessionFactory}>
                <HeroInstrument />
            </SessionFactoryProvider>
        </MemoryRouter>,
    ));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function button(name : string) : HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(element => element.textContent === name);
    if (!found) throw new Error(`No button "${name}".`);
    return found;
}

/** The value cell of the row of a monitor in the readout. */
function value(monitor : string) : string {
    const row = [...container.querySelectorAll("tbody tr")].find(element => element.querySelector("th a")?.textContent === monitor);
    return row?.querySelector("td")?.textContent ?? "";
}

function status() : string {
    return container.querySelector("[role=status]")?.textContent ?? "";
}

describe("HeroInstrument", () => {
    it("starts no monitor before the first input, then starts them at the first input", async () => {
        await vi.waitFor(() => expect(button("Block for 200 ms").disabled).toBe(false), patience);
        expect(status()).toBe("Not measuring");
        expect(container.textContent).toContain("The monitors start at your first input in this page.");
        act(() => { window.dispatchEvent(new PointerEvent("pointermove")); });
        await vi.waitFor(() => expect(status()).toBe("Measuring"), patience);
    });

    it("measures one block with five monitors", async () => {
        await vi.waitFor(() => expect(button("Start the monitors").disabled).toBe(false), patience);
        act(() => button("Start the monitors").click());
        // The ticks of the strip show that DriftLag and the worker operate
        await vi.waitFor(() => expect(container.querySelectorAll("svg line").length).toBeGreaterThan(20), patience);
        await new Promise(resolve => setTimeout(resolve, 1_000));

        act(() => button("Block for 200 ms").click());
        await vi.waitFor(() => {
            expect(container.querySelector("caption")?.textContent).toMatch(/^Block for 200 ms: the load took \d+ ms\./);
            expect(value("DriftLag")).toMatch(/^\d+ ms/);
            expect(value("Worker lag")).toMatch(/^\d+ ms/);
            expect(value("Frame timing")).toMatch(/^\d+ ms/);
        }, patience);
        expect(Number.parseInt(value("DriftLag"), 10)).toBeGreaterThan(150);
        expect(Number.parseInt(value("Worker lag"), 10)).toBeGreaterThan(80);
        // The values stay after the series of the session lose them (the series keep 10 s)
        await new Promise(resolve => setTimeout(resolve, 11_000));
        expect(Number.parseInt(value("Worker lag"), 10)).toBeGreaterThan(80);
        expect(value("Frame timing")).toMatch(/^\d+ ms/);
    }, 60_000);
});
