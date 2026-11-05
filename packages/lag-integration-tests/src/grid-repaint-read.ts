import { describe, it } from "vitest";
import { userEvent } from "vitest/browser";
import { createPageChangeClock, domPageChanges, type PageChangeClock } from "@mark1russell7/lag";
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
 *
 * The change clock of lag (`domPageChanges`) operates in each arm. Each period gives `sinceChangeMs` at its end.
 * In the repaint arm, the clock must see each change. In the input arm, the clock must not be a change.
 * Else the input arm does not fall to the grid, and the clock removes the condition that it reports.
 */

/** The time of each period. */
const PERIOD_MS = 10_000;

/** The count of periods, the same as in `grid-time-read.ts`. */
const PERIODS = 15;

/** The count of periods from one change to the next. */
const PERIODS_PER_CHANGE = 2;

/** This type is one period of an arm, with the change at its start, and the time since the last change at its end. */
type ArmPeriod = Period & { readonly changed : boolean; readonly sinceChangeMs : number };

/** This function reads the periods of one arm, with the change clock on. It calls `change` at the start of each second period. */
async function readArm(change : (index : number) => Promise<void>) : Promise<ArmPeriod[]> {
    const clock : PageChangeClock = createPageChangeClock(domPageChanges(MutationObserver, document), performance);
    const periods : ArmPeriod[] = [];
    try {
        for (let i = 0; i < PERIODS; i++) {
            const changed = i % PERIODS_PER_CHANGE === 0;
            if (changed) await change(i);
            const period = await readPeriod(`${(i + 1) * PERIOD_MS / 1000} s`, PERIOD_MS, false);
            periods.push({ ...period, changed, sinceChangeMs : Math.round(clock.sinceChangeMs()) });
        }
    } finally {
        clock.dispose();
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
