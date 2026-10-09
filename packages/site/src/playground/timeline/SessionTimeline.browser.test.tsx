import "../../styles/global.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frame, interaction, span, testModel } from "./fixtures";
import type { TimelineModel } from "./model";
import { SessionTimeline } from "./SessionTimeline";
import { ALL_TRACKS, layoutTracks } from "./tracks";

// React needs this flag for act() outside a test renderer
(globalThis as { IS_REACT_ACT_ENVIRONMENT? : boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const model : TimelineModel = testModel({
    now : 60,
    start : -1,
    running : false,
    pageViews : [{ ...span("v", "lag.page_view", -1, 60, { navigation_type : "navigate" }), open : true }],
    lifecycle : [{ start : 0, end : 60, state : "active", trigger : undefined, open : true }],
    drift : Array.from({ length : 600 }, (_, index) => ({ t : (index + 1) / 10, value : index === 405 ? 780 : 1 })),
    macrotask : [{ t : 5, value : 2 }, { t : 40, value : 9 }],
    frames : [frame(40, 800, 750), frame(50, 120, 70)],
    hangs : [span("h", "lag.main_thread.hang", 52, 58.1, { phase : "ended" })],
    stalls : [span("s", "lag.stall", 51.9, 58.2, { kind : "hang" })],
    interactions : [interaction(1, 39.99, 820)],
    vitals : [{ name : "INP", t : 39.99, value : 820, rating : "poor" }],
    loads : [{ start : 39.98, end : 40.8, label : "Block for 800 ms", aborted : false, active : false }],
});

let container : HTMLDivElement;
let root : Root;

beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "1000px";
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

async function renderTimeline(data : TimelineModel = model) : Promise<{ host : HTMLElement; canvas : HTMLCanvasElement }> {
    act(() => root.render(<SessionTimeline model={data} clock={() => 1_000} />));
    const canvas = container.querySelector("canvas")!;
    await vi.waitFor(() => {
        if (canvas.width === 0) throw new Error("The canvas has no size yet");
    });
    return { host : container.querySelector<HTMLElement>("[role='application']")!, canvas };
}

function press(target : HTMLElement, key : string) : void {
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles : true, cancelable : true }));
    });
}

const summary = () : string => container.querySelector("[role='application']")!.getAttribute("aria-describedby")!
    .split(" ").map(id => document.getElementById(id)?.textContent ?? "").join(" ");

/** The x of a time in the canvas, for the range of the summary ("From 30.9 s to 60.9 s"). */
function xOf(canvas : HTMLCanvasElement, time : number) : number {
    const match = /From (-?[\d.]+) s to (-?[\d.]+) s/.exec(summary())!;
    const [start, end] = [Number(match[1]), Number(match[2])];
    const width = canvas.getBoundingClientRect().width - 24;
    return canvas.getBoundingClientRect().left + 12 + ((time - start) / (end - start)) * width;
}

describe("SessionTimeline", () => {
    it("draws the tracks, and follows the present time", async () => {
        const { canvas } = await renderTimeline();
        expect(canvas.style.height).toBe(`${layoutTracks(ALL_TRACKS).height}px`);
        expect(summary()).toContain("From 30.9 s to 60.9 s (live)");
        expect(summary()).toContain("2 long frames, 1 hang, 1 stall, 1 interaction");
        expect(container.querySelector("button[aria-pressed='true']")?.textContent).toContain("Follow live");
        // The canvas is not empty: some pixels are not the color of the surface
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<number>();
        for (let index = 0; index < pixels.length; index += 4 * 97) colors.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
        expect(colors.size).toBeGreaterThan(5);
    });

    it("hides a track when its check box is cleared", async () => {
        const { canvas } = await renderTimeline();
        const before = Number.parseFloat(canvas.style.height);
        const checkbox = [...container.querySelectorAll("label")].find(label => label.textContent === "Drift lag")!.querySelector("input")!;
        act(() => checkbox.click());
        await vi.waitFor(() => expect(Number.parseFloat(canvas.style.height)).toBe(before - (17 + 64 + 9)));
    });

    it("zooms, pans and shows all with the keyboard, and stops following", async () => {
        const { host } = await renderTimeline();
        press(host, "+");
        expect(summary()).toMatch(/From 36\.\d+ s to 60\.\d+ s \(live\)/);
        press(host, "ArrowLeft");
        expect(summary()).not.toContain("(live)");
        expect(container.querySelector("button[aria-pressed='false']")?.textContent).toContain("Follow live");
        press(host, "0");
        expect(summary()).toContain("From -1 s to 60 s.");
        press(host, "End");
        expect(summary()).toContain("(live)");
    });

    it("goes to the next item with the keyboard, describes it and announces it", async () => {
        const { host } = await renderTimeline();
        const selected = () : string => container.querySelector("section[aria-label='Selected item']")?.textContent ?? "";
        press(host, "0");
        // The first item after the middle of the range (29.5 s)
        press(host, ".");
        expect(selected()).toContain("Load from this page");
        expect(container.querySelector("[aria-live='polite']")?.textContent).toBe("Load from this page: Block for 800 ms, at 39.98 s.");
        press(host, ".");
        expect(selected()).toContain("INP");
        press(host, ".");
        expect(selected()).toContain("Interaction (pointer)");
        press(host, ",");
        press(host, ",");
        expect(selected()).toContain("Load from this page");
        press(host, "Escape");
        expect(selected()).toBe("");
    });

    it("shows a tooltip for the item under the pointer", async () => {
        const { canvas } = await renderTimeline();
        const track = layoutTracks(ALL_TRACKS).tracks.find(candidate => candidate.id === "frames")!;
        const rect = canvas.getBoundingClientRect();
        act(() => {
            canvas.dispatchEvent(new PointerEvent("pointermove", { clientX : xOf(canvas, 40.3), clientY : rect.top + track.contentTop + 8, bubbles : true }));
        });
        const tooltip = [...container.querySelectorAll("div")].find(element => element.className.includes("tooltip"));
        expect(tooltip?.textContent).toContain("Long animation frame");
        expect(tooltip?.textContent).toContain("750 ms");
        act(() => {
            canvas.dispatchEvent(new PointerEvent("pointerout", { bubbles : true, relatedTarget : document.body }));
        });
        expect([...container.querySelectorAll("div")].some(element => element.className.includes("tooltip"))).toBe(false);
    });

    it("gives the items of the visible range as a table", async () => {
        await renderTimeline();
        const details = [...container.querySelectorAll("details")].find(element => element.querySelector("summary")?.textContent === "Show the data as a table")!;
        expect(details.querySelector("table")).toBeNull();
        act(() => details.querySelector("summary")!.click());
        await vi.waitFor(() => expect(details.querySelector("table")).not.toBeNull());
        const text = details.querySelector("table")!.textContent!;
        expect(text).toContain("Long animation frame");
        expect(text).toContain("Hang (span lag.main_thread.hang)");
    });

    it("keeps the frame rate of an empty timeline with thousands of items", async () => {
        const dense = testModel({
            now : 600,
            running : true,
            drift : Array.from({ length : 4_096 }, (_, index) => ({ t : index * 0.14, value : (index * 37) % 400 })),
            frames : Array.from({ length : 5_000 }, (_, index) => frame(index * 0.12, 60 + (index % 9) * 20, (index % 9) * 20)),
            interactions : Array.from({ length : 2_000 }, (_, index) => interaction(index + 1, index * 0.3, 40 + (index % 30) * 10)),
            shifts : Array.from({ length : 1_000 }, (_, index) => ({ t : index * 0.6, value : 0.01 })),
            hangs : [span("h", "hang", 100, 106)],
        });
        // The "follow live" mode draws the timeline in each animation frame. All items are visible.
        async function framesIn(data : TimelineModel, milliseconds : number) : Promise<number> {
            const { host } = await renderTimeline(data);
            press(host, "0");
            press(host, "f");
            let frames = 0;
            await new Promise<void>((resolve) => {
                const end = performance.now() + milliseconds;
                const step = (now : number) : void => {
                    frames++;
                    if (now < end) requestAnimationFrame(step);
                    else resolve();
                };
                requestAnimationFrame(step);
            });
            return frames;
        }
        // The empty timeline is the reference, because a busy test machine has a lower frame rate for both
        const empty = await framesIn(testModel({ now : 600, running : true }), 1_500);
        const full = await framesIn(dense, 1_500);
        expect(full).toBeGreaterThanOrEqual(Math.floor(empty * 0.8));
    });
});
