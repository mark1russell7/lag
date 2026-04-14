/**
 * A handle to a monitor that was (or tried to be) created.
 *
 * `monitor` is `T | undefined` because monitor construction can fail — e.g.
 * the browser may not support PressureObserver, FinalizationRegistry, or
 * requestIdleCallback. In those cases a factory returns a handle with
 * `monitor: undefined` and a no-op `stop()`, allowing the caller to continue
 * without branching.
 *
 * `name` is a stable identifier that consumers can use to look the handle up
 * in a MonitorRegistry.
 */
export type MonitorHandle<T = unknown> = {
    readonly name : string;
    readonly monitor : T | undefined;
    stop() : void;
};
