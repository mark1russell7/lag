import type { LoadActionId, ProfileId } from "../adapters/lag-load";

/** The text of the load controls. The behavior is in `adapters/lag-load.ts`. */
export type LoadActionInfo = {
    id : LoadActionId;
    label : string;
    description : string;
};

export const LOAD_ACTIONS : readonly LoadActionInfo[] = [
    { id : "block-50", label : "Block for 50 ms", description : "The button keeps the main thread busy for 50 ms." },
    { id : "block-200", label : "Block for 200 ms", description : "The button keeps the main thread busy for 200 ms." },
    { id : "block-800", label : "Block for 800 ms", description : "The button keeps the main thread busy for 800 ms." },
    { id : "block-6000", label : "Hang for 6 s", description : "The button keeps the main thread busy for 6 s. The page does not respond. After 5 s, the worker detects a hang, and the measurement conditions record a stall." },
    { id : "layout-thrash", label : "Layout thrash", description : "The button reads and changes the layout in a loop for 150 ms. This causes style and layout work." },
    { id : "gc-pressure", label : "Make garbage", description : "The button makes many short-lived objects for 300 ms. This can start a garbage collection." },
    { id : "long-animation-frame", label : "Long animation frame", description : "The button does 150 ms of work in an animation frame callback." },
    { id : "macrotask-flood", label : "Macrotask flood", description : "The button starts a chain of 1,000 setTimeout(0) tasks, one after the other. After the fifth step, the browser waits at least 4 ms for each step. Thus the chain takes approximately 4 s, and the load is small." },
    { id : "microtask-flood", label : "Microtask flood", description : "The button puts 200,000 microtasks in the queue. They start before the next task." },
];

export type ProfileInfo = {
    id : ProfileId;
    label : string;
    description : string;
};

export const PROFILES : readonly ProfileInfo[] = [
    { id : "light", label : "Light", description : "Usually idle, with small CPU spikes of approximately 5 to 20 ms." },
    { id : "moderate", label : "Moderate", description : "CPU bursts, task bursts, layout work and long animation frames." },
    { id : "heavy", label : "Heavy", description : "Sustained CPU load with large spikes, garbage and layout thrash." },
    { id : "bursty", label : "Bursty", description : "Most events are small, but approximately 5% are very large." },
    { id : "evolutionary", label : "Evolutionary", description : "The load increases with time." },
    { id : "kitchen-sink", label : "Kitchen sink", description : "All load types at the same time." },
];

export function loadLabel(kind : "action" | "profile", id : string) : string {
    if (kind === "action") return LOAD_ACTIONS.find(action => action.id === id)?.label ?? id;
    const profile = PROFILES.find(candidate => candidate.id === id);
    return profile ? `${profile.label} profile` : id;
}
