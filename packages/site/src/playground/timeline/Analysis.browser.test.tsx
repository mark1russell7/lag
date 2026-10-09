import "../../styles/global.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpochPanel } from "./EpochPanel";
import { frame, interaction, testModel } from "./fixtures";
import { InpScatterPanel } from "./InpScatterPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT? : boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const starts = [10, 20, 30];
const model = testModel({
    now : 40,
    drift : Array.from({ length : 400 }, (_, index) => {
        const t = (index * 100 + 50) / 1000;
        return { t, value : starts.some(start => Math.abs(t - start - 0.85) < 1e-6) ? 800 : 1 };
    }),
    frames : starts.map(start => frame(start, 820, 770)),
    interactions : [...starts.map((start, index) => interaction(index + 1, start - 0.01, 840)), interaction(9, 35, 40, "keyboard")],
    vitals : [{ name : "INP", t : 9.99, value : 840, rating : "poor" }],
});

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

async function chartsDrawn(count : number) : Promise<void> {
    await vi.waitFor(() => {
        expect(container.querySelectorAll("figure svg[aria-label]").length).toBe(count);
    }, { timeout : 15_000 });
    expect(container.textContent).not.toMatch(/did not (?:render|load)/);
}

describe("EpochPanel", () => {
    it("draws the three signals around the blocks", async () => {
        act(() => root.render(<EpochPanel model={model} />));
        expect(container.textContent).toContain("3 blocks: 3 with a long frame, 0 with a hang.");
        await chartsDrawn(3);
        const labels = [...container.querySelectorAll("figure svg[aria-label]")].map(svg => svg.getAttribute("aria-label"));
        expect(labels).toEqual(["Drift lag", "Blocking time of long animation frames", "Interaction duration"]);
        // The text alternative of the drift chart names its peak: the windows end 0.85 s after the start
        expect(container.querySelector("figure svg")?.getAttribute("aria-description")).toContain("The highest mean is 800 ms, at 0.85 s.");
    });

    it("changes the time 0 to the end of the blocks", async () => {
        act(() => root.render(<EpochPanel model={model} />));
        await chartsDrawn(3);
        const end = container.querySelector<HTMLInputElement>("input[value='end']")!;
        act(() => end.click());
        await vi.waitFor(() => expect(container.querySelector("figure svg")?.getAttribute("aria-description")).toContain("The time 0 is the block end"));
        // The blocks end at 0.82 s, and the drift windows end 30 ms later
        expect(container.querySelector("figure svg")?.getAttribute("aria-description")).toContain("The highest mean is 800 ms, at 0.05 s.");
    });

    it("tells what to do when there are no blocks, and keeps the place of the charts", async () => {
        act(() => root.render(<EpochPanel model={testModel()} />));
        expect(container.textContent).toContain("No long blocks yet.");
        expect(container.textContent).toContain("Each block adds one epoch.");
        await chartsDrawn(3);
        expect(container.textContent).not.toContain("No DriftLag windows near the blocks.");
    });
});

describe("InpScatterPanel", () => {
    it("draws one dot for each interaction, with the INP thresholds", async () => {
        act(() => root.render(<InpScatterPanel model={model} />));
        expect(container.textContent).toContain("4 interactions. 3 overlap a long animation frame. 3 took more than 200 ms, and 3 of them overlap a long frame.");
        expect(container.textContent).toContain("The INP of this page view is 840 ms.");
        expect(container.querySelector("ul[aria-label='Marks of the chart']")?.textContent).toBe("Pointer (click, tap)KeyboardDuration equal to the blocking time");
        await chartsDrawn(1);
        const svg = container.querySelector("figure svg")!;
        expect(svg.querySelectorAll("circle")).toHaveLength(4);
        expect(svg.textContent).toContain("Poor INP: more than 500 ms");
        // Each tick of the log axis has its label
        const yLabels = [...svg.querySelectorAll("g[aria-label='y-axis tick label'] text")].map(text => text.textContent);
        expect(yLabels).toContain("500");
        expect(yLabels).toContain("50");
    });

    it("tells that a browser without long animation frames puts all dots at 0 ms", () => {
        act(() => root.render(<InpScatterPanel model={{ ...model, support : { ...model.support, longAnimationFrame : false } }} />));
        expect(container.textContent).toContain("This browser does not report long animation frames.");
    });
});
