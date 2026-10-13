import "../styles/global.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DriftStepper from "./drift/DriftStepper";
import HistogramMerge from "./histogram/HistogramMerge";
import LifecycleLive from "./lifecycle/LifecycleLive";
import ProbeLoops from "./probes/ProbeLoops";

(globalThis as { IS_REACT_ACT_ENVIRONMENT? : boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container : HTMLDivElement;
let root : Root;

beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "640px";
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** This function sets the value of an input as a reader does, so that React gets the change event. */
function setValue(input : HTMLInputElement | HTMLSelectElement, value : string) : void {
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles : true }));
}

function inputLabelled(text : string) : HTMLInputElement {
    const label = [...container.querySelectorAll("label")].find(candidate => candidate.textContent?.includes(text));
    const input = label?.querySelector("input") ?? (label?.htmlFor ? document.getElementById(label.htmlFor) : null);
    if (!(input instanceof HTMLInputElement)) throw new Error(`No input with the label "${text}"`);
    return input;
}

function statValue(label : string) : string | undefined {
    const term = [...container.querySelectorAll("dt")].find(candidate => candidate.textContent?.includes(label));
    return term?.nextElementSibling?.textContent ?? undefined;
}

describe("DriftStepper", () => {
    it("shows the lag of the window with the block, less than the block by less than one step", () => {
        act(() => root.render(<DriftStepper />));
        expect(container.querySelector("[role='img'] svg")).not.toBeNull();
        expect(statValue("Steps in each window")).toBe("6");
        expect(statValue("Blocked time")).toBe("120 ms");
        expect(container.textContent).toContain("It is less than one step.");
        const lag = Number.parseFloat(statValue("Lag of all windows") ?? "");
        expect(lag).toBeGreaterThan(120 - 15.6);
        expect(lag).toBeLessThanOrEqual(120);
    });

    it("gives false lag without calibration, and no lag without a block", () => {
        act(() => root.render(<DriftStepper />));
        act(() => setValue(inputLabelled("Duration of the long task"), "0"));
        expect(container.textContent).toContain("An idle window has a lag near 0 ms.");
        const checkbox = inputLabelled("Subtract the calibrated baseline");
        act(() => checkbox.click());
        expect(container.textContent).toContain("Without calibration");
        expect(statValue("Steps in each window")).toBe("20");
        expect(statValue("Baseline step")).toBe("5 ms");
    });
});

describe("HistogramMerge", () => {
    it("keeps the estimate of the merged buckets nearer to the correct value than the mean of the percentiles", async () => {
        act(() => root.render(<HistogramMerge />));
        await vi.waitFor(() => {
            expect(container.querySelector("figure svg[aria-label]")).not.toBeNull();
        }, { timeout : 15_000 });
        const read = (label : string) : number => Number.parseFloat(statValue(label) ?? "");
        const pooled = read("p95 of all samples");
        expect(Math.abs(read("From the merged buckets") - pooled)).toBeLessThan(Math.abs(read("Mean of the three p95") - pooled));
        const before = read("Mean of the three p95");
        act(() => setValue(inputLabelled("Median latency"), "300"));
        expect(read("Mean of the three p95")).not.toBe(before);
        expect(container.textContent).not.toMatch(/did not (?:render|load)/);
    });
});

describe("ProbeLoops", () => {
    it("gives the table of the worked example of the statistics page", () => {
        act(() => root.render(<ProbeLoops />));
        const rows = [...container.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent));
        expect(rows).toEqual([
            ["Number of samples", "300", "60"],
            ["Samples of 1 s or more", "1 (0.3%)", "30 (50%)"],
            ["95th percentile", "0 ms", "27 s"],
            ["Mean", "100 ms", "7.75 s"],
            ["Sum", "30 s", "Not applicable"],
        ]);
        expect(container.textContent).toContain("An event at a random time of the minute waits 7.5 s on average.");
    });
});

describe("LifecycleLive", () => {
    it("shows the state of this tab and each transition of the shared tracker", async () => {
        act(() => root.render(<LifecycleLive />));
        await vi.waitFor(() => {
            expect(container.querySelector("[aria-current='step']")).not.toBeNull();
        });
        const before = container.querySelector("[aria-current='step']")?.textContent;
        expect(before).toMatch(/^(active|passive|hidden)/);
        act(() => {
            window.dispatchEvent(new FocusEvent("blur"));
            window.dispatchEvent(new FocusEvent("focus"));
        });
        // A blur changes only an active page, and a focus only a passive page
        if (before?.startsWith("active")) {
            await vi.waitFor(() => expect(container.textContent).toContain("Last transition: passive → active by focus"));
            const cells = [...container.querySelectorAll("tbody tr")].map(row => row.textContent);
            expect(cells[0]).toContain("passiveactivefocus");
            expect(cells[1]).toContain("activepassiveblur");
        }
        expect(container.textContent).toContain("getState()");
    });
});
