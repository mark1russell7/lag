/**
 * The loops of the await probe that the plugin of async-browser-context does
 * not transform (the build excludes this module). Each loop does `count`
 * sequential steps.
 */

/** A native async function with `count` awaits of a value that is not a promise. */
export async function nativeAwait(count : number) : Promise<void> {
    for (let i = 0; i < count; i++) await null;
}

/**
 * A native async function with `count` awaits of a resolved promise. The
 * promise comes from the global `Promise`, thus in the build `zone` it is a
 * promise of zone.js.
 */
export async function nativeAwaitPromise(count : number) : Promise<void> {
    const resolved = Promise.resolve();
    for (let i = 0; i < count; i++) await resolved;
}

/** A chain of `count` `queueMicrotask` callbacks, one after the other, as `microtaskFlood` of `@lag/load`. */
export function microtaskChain(count : number) : Promise<void> {
    return new Promise<void>((resolve) => {
        let left = count;
        const tick = () : void => {
            left--;
            if (left > 0) queueMicrotask(tick);
            else resolve();
        };
        queueMicrotask(tick);
    });
}

/**
 * A generator that a minimal coroutine operates, without a context: each
 * step is one `Promise.resolve()` and one `then`, as in the coroutine of
 * async-browser-context. The probe uses it only in the build without the
 * library, thus `nativeThen` is the native function.
 */
export function generatorThen(count : number, nativeThen : typeof Promise.prototype.then) : Promise<void> {
    function* body() : Generator<null, void, unknown> {
        for (let i = 0; i < count; i++) yield null;
    }
    const generator = body();
    return new Promise<void>((resolve, reject) => {
        const step = (value : unknown) : void => {
            const result = generator.next(value);
            if (result.done) {
                resolve();
                return;
            }
            nativeThen.call(Promise.resolve(result.value), step, reject);
        };
        step(undefined);
    });
}
