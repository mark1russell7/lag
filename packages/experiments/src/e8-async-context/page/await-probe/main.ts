/**
 * The await probe of E8. It measures `count` sequential awaits in the forms
 * of the workload `await-loop`, and a chain of `count` microtasks. The build
 * `plain` has no async context. The build `async-context` has the patches of
 * async-browser-context, and its plugin transforms this module, but not
 * `native.ts`. The build `zone` loads zone.js.
 */
import { generatorThen, microtaskChain, nativeAwait, nativeAwaitPromise } from "./native.js";

type ProbeVariant =
    | "native-await"
    | "native-await-promise"
    | "generator-then"
    | "transformed-await"
    | "transformed-await-promise"
    | "transformed-await-hook"
    | "queue-microtask";

type AwaitProbe = {
    ready : boolean;
    build : string;
    variants : ProbeVariant[];
    run(variant : ProbeVariant, count : number) : Promise<number>;
};

declare global {
    interface Window {
        awaitProbe? : AwaitProbe;
    }
}

/** An async function in this module. The build `async-context` transforms it into a generator. */
async function transformedAwait(count : number) : Promise<void> {
    for (let i = 0; i < count; i++) await null;
}

/** The same as `transformedAwait`, with awaits of a resolved promise. */
async function transformedAwaitPromise(count : number) : Promise<void> {
    const resolved = Promise.resolve();
    for (let i = 0; i < count; i++) await resolved;
}

type HookApi = { addCallbackHook(hook : { before?() : void; after?() : void }) : () => void };

async function start() : Promise<void> {
    const build = import.meta.env["VITE_PROBE_BUILD"] as string;
    // The library loads only in its build. Its plugin transforms this module there.
    const library : HookApi | undefined = build === "async-context" ? await import("async-browser-context") : undefined;
    // zone.js patches the globals when it loads, thus also `queueMicrotask`
    if (build === "zone") await import("zone.js");
    const steps : Record<ProbeVariant, ((count : number) => Promise<void>) | undefined> = {
        "queue-microtask" : microtaskChain,
        "native-await" : nativeAwait,
        "native-await-promise" : nativeAwaitPromise,
        // Only in the build `plain`: the other builds replace `then` before this module operates
        "generator-then" : build === "plain" ? (count) => generatorThen(count, Promise.prototype.then) : undefined,
        "transformed-await" : library ? transformedAwait : undefined,
        "transformed-await-promise" : library ? transformedAwaitPromise : undefined,
        "transformed-await-hook" : library
            ? async (count) => {
                // A hook with no work: the cost of the hook path of the coroutine
                const remove = library.addCallbackHook({ before() {}, after() {} });
                try {
                    await transformedAwait(count);
                } finally {
                    remove();
                }
            }
            : undefined,
    };
    window.awaitProbe = {
        ready : true,
        build,
        variants : (Object.keys(steps) as ProbeVariant[]).filter(variant => steps[variant] !== undefined),
        async run(variant, count) {
            const step = steps[variant];
            if (!step) throw new Error(`The build ${build} has no variant ${variant}.`);
            const begin = performance.now();
            await step(count);
            return performance.now() - begin;
        },
    };
}

void start();
