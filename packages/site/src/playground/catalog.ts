import type { LoadActionId, ProfileId } from "../adapters/lag-load";

/** The text of the load controls. The behavior is in `adapters/lag-load.ts`. */
export type LoadActionInfo = {
    id : LoadActionId;
    label : string;
    description : string;
};

export const LOAD_ACTIONS : readonly LoadActionInfo[] = [
    { id : "block-50", label : "Block for 50 ms", description : "Runs a busy loop on the main thread for 50 ms." },
    { id : "block-200", label : "Block for 200 ms", description : "Runs a busy loop on the main thread for 200 ms." },
    { id : "block-800", label : "Block for 800 ms", description : "Runs a busy loop on the main thread for 800 ms." },
    { id : "layout-thrash", label : "Layout thrash", description : "Reads and changes the layout in a loop for 150 ms. This forces style and layout work." },
    { id : "gc-pressure", label : "Make garbage", description : "Makes many short-lived objects for 300 ms. This can start a garbage collection." },
    { id : "long-animation-frame", label : "Long animation frame", description : "Runs 150 ms of work in an animation frame callback." },
    { id : "macrotask-flood", label : "Macrotask flood", description : "Queues 1,000 setTimeout(0) tasks." },
    { id : "microtask-flood", label : "Microtask flood", description : "Queues 200,000 microtasks. They run before the next task." },
];

export type ProfileInfo = {
    id : ProfileId;
    label : string;
    description : string;
};

export const PROFILES : readonly ProfileInfo[] = [
    { id : "light", label : "Light", description : "Mostly idle, with small CPU spikes of about 5 to 20 ms." },
    { id : "moderate", label : "Moderate", description : "CPU bursts, task bursts, layout work and long animation frames." },
    { id : "heavy", label : "Heavy", description : "Sustained CPU load with large spikes, garbage and layout thrash." },
    { id : "bursty", label : "Bursty", description : "Most events are small, but about 5% are very large." },
    { id : "evolutionary", label : "Evolutionary", description : "The load increases over time." },
    { id : "kitchen-sink", label : "Kitchen sink", description : "All load types at the same time." },
];

export function loadLabel(kind : "action" | "profile", id : string) : string {
    if (kind === "action") return LOAD_ACTIONS.find(action => action.id === id)?.label ?? id;
    const profile = PROFILES.find(candidate => candidate.id === id);
    return profile ? `${profile.label} profile` : id;
}
