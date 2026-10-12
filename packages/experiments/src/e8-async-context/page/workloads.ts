/**
 * The fixed amounts of asynchronous work of measurement 2. Each workload
 * gives a promise that resolves when all of its work is complete. The
 * amounts are large enough for the clock resolution of each engine (1 ms or
 * less).
 */
import { microtaskFlood, promiseChain } from "@lag/load";
import { DATA_PATH, type WorkloadName } from "../shared/types.js";

const dataUrl = () : string => new URL(DATA_PATH, document.baseURI).href;

/** One async function that awaits `count` times. */
async function awaitLoop(count : number) : Promise<void> {
    for (let i = 0; i < count; i++) await null;
}

/** `tasks` async functions at the same time, with `awaits` awaits each. */
async function asyncCalls(tasks : number, awaits : number) : Promise<void> {
    const task = async () : Promise<void> => {
        for (let i = 0; i < awaits; i++) await null;
    };
    await Promise.all(Array.from({ length : tasks }, task));
}

/** `count` zero-delay timers at the same time. */
async function parallelTimers(count : number) : Promise<void> {
    await Promise.all(Array.from({ length : count }, () => new Promise<void>(resolve => setTimeout(resolve, 0))));
}

/** `count` synchronous dispatches of an event, with one listener. */
async function dispatchEvents(count : number) : Promise<void> {
    const target = new EventTarget();
    let calls = 0;
    const listener = () : void => { calls++; };
    target.addEventListener("e8", listener);
    for (let i = 0; i < count; i++) target.dispatchEvent(new Event("e8"));
    target.removeEventListener("e8", listener);
    if (calls !== count) throw new Error(`The listener got ${calls} of ${count} events.`);
}

/** `batches` groups of `size` fetches at the same time, one group after the other. Each fetch reads the JSON body. */
async function fetches(batches : number, size : number) : Promise<void> {
    const url = dataUrl();
    for (let batch = 0; batch < batches; batch++) {
        await Promise.all(Array.from({ length : size }, () => fetch(url).then(response => response.json())));
    }
}

/**
 * `count` operations at the same time, as in an application: a fetch, the
 * JSON body, a zero-delay timer, 10 events and 10 awaits.
 */
async function operations(count : number) : Promise<void> {
    const url = dataUrl();
    const target = new EventTarget();
    let calls = 0;
    const listener = () : void => { calls++; };
    target.addEventListener("e8-operation", listener);
    const operation = async () : Promise<number> => {
        const response = await fetch(url);
        const data = await response.json() as { items : unknown[] };
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        for (let i = 0; i < 10; i++) target.dispatchEvent(new Event("e8-operation"));
        let total = 0;
        for (let i = 0; i < 10; i++) total += await Promise.resolve(i);
        return total + data.items.length;
    };
    await Promise.all(Array.from({ length : count }, operation));
    target.removeEventListener("e8-operation", listener);
    if (calls !== count * 10) throw new Error(`The listener got ${calls} of ${count * 10} events.`);
}

const WORKLOADS : Readonly<Record<WorkloadName, () => Promise<void>>> = {
    // @lag/load: a chain of 50,000 `then` calls
    "promise-chain" : () => promiseChain(50_000)(0),
    "await-loop" : () => awaitLoop(50_000),
    "async-calls" : () => asyncCalls(5_000, 10),
    // @lag/load: 50,000 `queueMicrotask` callbacks, one after the other
    "microtasks" : () => microtaskFlood(50_000)(0),
    "timers" : () => parallelTimers(2_000),
    "events" : () => dispatchEvents(50_000),
    "fetch" : () => fetches(10, 10),
    "operations" : () => operations(200),
};

/** This function does one workload and gives its duration, in ms. */
export async function runWorkload(name : WorkloadName) : Promise<number> {
    const start = performance.now();
    await WORKLOADS[name]();
    return performance.now() - start;
}
