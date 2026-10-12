/**
 * The export `@mark1russell7/lag/async-context`: an optional add-on that
 * finds the code and the operation of each long callback, in all browsers.
 *
 * The add-on uses the callback hook of async-browser-context 0.2 or later
 * (`addCallbackHook`). The app gives the hook function. Thus this module
 * does not import async-browser-context, and the main export of the package
 * does not import this module. The app imports async-browser-context first
 * in its entry file, as the library tells.
 *
 * ```ts
 * import { addCallbackHook } from "async-browser-context";
 * import { setupLongCallbacks } from "@mark1russell7/lag/async-context";
 *
 * const monitors = setupAllMonitors(createBrowserDeps(window, options));
 * setupLongCallbacks(monitors, addCallbackHook);
 * ```
 *
 * The Vite plugin or the Babel preset of async-browser-context is necessary
 * only for the steps of async functions after an `await`. That transform is
 * a decision of the app, and it has a cost (refer to the documentation).
 *
 * @packageDocumentation
 */
export {
    LongCallbackMonitor,
    LONG_CALLBACK_THRESHOLD_MS,
    ANONYMOUS_CALLBACK,
    type LongCallback,
    type LongCallbackOptions,
    type CallbackHookLike,
    type AddCallbackHookFn,
} from "./LongCallbackMonitor.js";
export {
    createInstrumentedLongCallbacks,
    setupLongCallbacks,
    activeSpanName,
    type CallbackHookDeps,
    type OtelActiveSpanApiLike,
} from "./long-callbacks.js";
export { CALLBACK_SOURCE_KINDS, callbackSourceKind, type CallbackSourceKind } from "./source-kind.js";
