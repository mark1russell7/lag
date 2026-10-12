# Changelog

## 0.2.0

### New

- **The add-on `@mark1russell7/lag/async-context`.** It finds the long callbacks: the callbacks of 50 ms or more, with the hook of [async-browser-context](https://www.npmjs.com/package/async-browser-context) 0.2.2 or later (an optional peer dependency). Each long callback gives the name of the function, its source (for example `setTimeout` or `addEventListener:click`), a closed source kind and the operation. The add-on records the histogram `lag_long_callback_duration_histogram`, the event `lag.long_callback` and the span `lag.long_callback`. Thus Firefox and Safari also get an attribution of the lag, and Chromium gets the function names back when async-browser-context wraps the callbacks. Refer to the page [long callbacks](https://mark1russell7.github.io/lag/docs/monitors/long-callbacks).
- **`AllMonitorHandles.add(factory)`.** It registers a monitor that the application adds, with the dependencies of the setup: the page-view context, the spans and the stop.

### Fixed

- **GCSignalDetector.** When `onGC` stopped and started the detector, the detector armed two canaries. After that, each garbage collection counted two times. The detector now arms a canary only when no canary is in flight.

### Tests

- The mutation score of the package is 98.1% (it was 95.9%). The tests examine 1165 cases.

## 0.1.0

The first version on npm.
