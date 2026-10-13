import "../../styles/global.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FourLags } from "./FourLags";

(globalThis as { IS_REACT_ACT_ENVIRONMENT? : boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container : HTMLDivElement;
let root : Root;

beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "720px";
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<MemoryRouter><FourLags /></MemoryRouter>));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** The value of the readout with this letter. */
function readout(letter : string) : string {
    const item = [...container.querySelectorAll("dl > div")].find(element => element.querySelector("dt")?.textContent?.startsWith(letter));
    return item?.querySelector("dd")?.textContent ?? "";
}

/** This function sets a range input as a reader does: React reads the value in the input event. */
function setRange(label : string, value : number) : void {
    const input = [...container.querySelectorAll<HTMLInputElement>("input[type=range]")]
        .find(element => element.labels?.[0]?.textContent === label)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
        setter.call(input, String(value));
        input.dispatchEvent(new Event("input", { bubbles : true }));
    });
}

describe("FourLags", () => {
    it("shows the four quantities of the default example", () => {
        expect(readout("A")).toBe("307 ms");
        expect(readout("B")).toBe("210 ms");
        expect(readout("C")).toBe("333 ms");
        expect(readout("D")).toBe("217 ms");
        expect(container.querySelector("svg[role=img]")?.getAttribute("aria-label")).toContain("from 150 to 450 ms");
    });

    it("changes only the input latency much when the click moves out of the task", () => {
        setRange("Time of the click", 600);
        expect(readout("D")).toBe("17 ms");
        expect(container.textContent).toContain("INP: good");
        // The handlers of the click take 12 ms: they add a few milliseconds to a window
        expect(readout("A")).toBe("312 ms");
        expect(readout("B")).toBe("210 ms");
    });

    it("gives no input latency without a click, and a longer task gives more blocked time", () => {
        const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
        act(() => checkbox.click());
        expect(readout("D")).toBe("None");
        expect(container.textContent).toContain("Nobody clicks.");
        setRange("Length of the long task", 600);
        expect(readout("A")).toBe("600 ms");
    });

    it("moves the click to the place that the reader drags", () => {
        const svg = container.querySelector<SVGSVGElement>("svg[role=img]")!;
        const box = svg.getBoundingClientRect();
        act(() => {
            svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles : true, button : 0, pointerId : 1, clientX : box.left + box.width * 0.9, clientY : box.top + 10 }));
            svg.dispatchEvent(new PointerEvent("pointerup", { bubbles : true, pointerId : 1 }));
        });
        expect(container.querySelector("output[for$='-click']")?.textContent ?? "").not.toBe("250 ms");
        expect(readout("D")).not.toBe("217 ms");
    });
});
