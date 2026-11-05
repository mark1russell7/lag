import { describe, it } from "vitest";
import { userEvent } from "vitest/browser";
import { pageState } from "./animation-frames.js";
import { readPeriod, type Period } from "./grid-read.js";

/**
 * This read is for the question: does a repaint hold off the grid of 1 s, or does input hold it off?
 * In `grid-input-read.ts`, a click each 20 s held off the grid, but each click also repainted the button.
 * WebKit on macOS marks a page "visually idle" when the window server tells it that the window changes of the app
 * stopped (`PageClientImpl::isVisuallyIdle`). A repaint is a window change, and an input with no change of the look is not.
 * The first arm changes one text node each 20 s, with no input. The second arm clicks each 20 s on an element whose
 * look does not change: no focus, no selection, no hover or active style. The page has no load.
 * The name of this file does not end in `.test.ts`, so a normal run leaves it out.
 * The Safari job starts it alone, in a new session of Safari, with `LAG_SAFARI_READ=repaint`.
 */

/** The time of each period. */
const PERIOD_MS = 10_000;

/** The count of periods, the same as in `grid-time-read.ts`. */
const PERIODS = 15;

/** The count of periods from one change to the next. */
const PERIODS_PER_CHANGE = 2;

/** This type is one period of an arm, with the change at its start. */
type ArmPeriod = Period & { readonly changed : boolean };

/** This function reads the periods of one arm. It calls `change` at the start of each second period. */
async function readArm(change : (index : number) => Promise<void>) : Promise<ArmPeriod[]> {
    const periods : ArmPeriod[] = [];
    for (let i = 0; i < PERIODS; i++) {
        const changed = i % PERIODS_PER_CHANGE === 0;
        if (changed) await change(i);
        periods.push({ ...await readPeriod(`${(i + 1) * PERIOD_MS / 1000} s`, PERIOD_MS, false), changed });
    }
    return periods;
}

describe("The grid of 1 s of Safari on a CI runner: a repaint or an input", () => {
    it("reads the timer chain on a page that changes one text node each 20 s, with no input", async () => {
        const before = pageState();
        const text = document.createElement("p");
        text.textContent = "0";
        document.body.append(text);
        const periods = await readArm(async (index) => {
            text.textContent = String(index + 1);
        });
        text.remove();
        console.log(`grid-repaint read ${JSON.stringify({ arm : "repaint", userAgent : navigator.userAgent, before, periods })}`);
    }, PERIODS * PERIOD_MS + 60_000);

    it("reads the timer chain on a page with a click each 20 s on an element whose look does not change", async () => {
        const before = pageState();
        const target = document.createElement("div");
        // A div with no tabindex takes no focus. These styles keep its look the same under the pointer and the click.
        target.style.cssText = "width:120px;height:40px;user-select:none;-webkit-user-select:none;outline:none;cursor:default";
        let clicks = 0;
        target.addEventListener("click", () => {
            clicks += 1;
        });
        document.body.append(target);
        const periods = await readArm(async () => {
            await userEvent.click(target);
        });
        target.remove();
        console.log(`grid-repaint read ${JSON.stringify({ arm : "input", userAgent : navigator.userAgent, before, clicks, periods })}`);
    }, PERIODS * PERIOD_MS + 60_000);
});
