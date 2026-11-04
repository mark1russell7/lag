/**
 * The probe of the playground. The site check starts it in a browser at each width, before the deploy. A failed check
 * stops the deploy.
 *
 * The probe drives the core of the site: the real monitors measure the page that they are in. A button blocks the main
 * thread, and the timer drift shows that block. The monitors also stop and start again.
 *
 * The site check reads this TypeScript file directly. It removes the types and the `export` line, and it starts the
 * result as the body of an async function.
 */

// The site check gives these helpers to the probe.
declare const check : (name : string, ok : unknown, detail? : unknown) => boolean;
declare const until : <T>(fn : () => T | Promise<T>, ms? : number) => Promise<T>;
declare const $ : (selector : string) => Element | null;
declare const $$ : (selector : string) => Element[];
declare const click : (target : string | Element) => void;

/** The time for the page to load the monitors, in milliseconds. */
const LOAD = 15_000;
/** The position of the chart of the timer drift in the section of charts. */
const DRIFT = 0;
/** The position of the chart of the worker heartbeats in the section of charts. */
const WORKER = 1;

const pageText = () : string => document.body.textContent ?? "";
const operating = () : boolean => pageText().includes("The monitors operate");
const button = (label : string) : Element | undefined => $$("button").find((b) => b.textContent?.trim() === label);

/** This function gives the text of a value under a chart, for example "Values" of the timer drift. */
const stat = (chart : number, name : string) : string => {
    const section = $('section[aria-labelledby="charts-heading"]');
    const terms = [...(section?.querySelectorAll("dt") ?? [])].filter((term) => term.textContent === name);
    return terms[chart]?.nextElementSibling?.textContent ?? "";
};
/** This function gives the maximum of the timer drift in milliseconds. It gives 0 when the chart has no value. */
const driftMaximum = () : number => {
    const text = stat(DRIFT, "Maximum");
    return text.endsWith(" ms") ? Number.parseFloat(text) : text.endsWith(" s") ? Number.parseFloat(text) * 1000 : 0;
};

check("the monitors start", await until(operating, LOAD), pageText().slice(0, 200));
check("the timer drift has values", await until(() => Number(stat(DRIFT, "Values")) > 0, LOAD), stat(DRIFT, "Values"));
check("the worker sends heartbeats", await until(() => Number(stat(WORKER, "Values")) > 0, LOAD), stat(WORKER, "Values"));

// A block of the main thread shows in the timer drift, because the timers of the page wait for it.
const block = button("Block for 200 ms");
check("the load buttons are there", block !== undefined && $$("section[aria-labelledby=\"load-heading\"] button").length > 9);
const before = driftMaximum();
click(block as Element);
check("the load shows in the recent loads", await until(() => pageText().includes("Block for 200 ms at "), LOAD));
check("the block shows in the timer drift", await until(() => driftMaximum() > before && driftMaximum() >= 100, LOAD), `${before} to ${driftMaximum()}`);

// The monitors stop, and they start again.
click(button("Stop the monitors") as Element);
check("the monitors stop", await until(() => pageText().includes("The monitors are stopped."), LOAD));
click(button("Start the monitors") as Element);
check("the monitors start again", await until(operating, LOAD));

export {};
