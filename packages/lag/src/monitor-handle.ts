/**
 * A handle to a monitor that a factory made, or tried to make.
 *
 * The type of `monitor` is `T | undefined`, because the construction of a
 * monitor can fail. For example, the browser can have no `PressureObserver`,
 * `FinalizationRegistry` or `requestIdleCallback`. In that case, the factory
 * gives a handle with `monitor: undefined` and a `stop()` that does nothing.
 * Thus, the caller can continue without a branch.
 *
 * `name` is a stable identifier. A consumer can use it to find the handle in
 * a `MonitorRegistry`.
 */
export type MonitorHandle<T = unknown> = {
    readonly name : string;
    readonly monitor : T | undefined;
    stop() : void;
};
