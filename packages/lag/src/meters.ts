/**
 * The meter combinators, on the types of `@opentelemetry/api` only: the
 * fan-out meter, the tee, and the forwarding meter with its receiver. This
 * entry is their home. It has no runtime dependency.
 *
 * - `fanOutMeter(a, b, ...)` records into each meter of a list. A tee is a
 *   fan-out of two meters. An example is the real meter and a meter that
 *   keeps the values for a test or a heads-up display.
 * - `createForwardingMeter` sends the records to a different context,
 *   usually a worker that hosts the OpenTelemetry SDK. `createMeterReceiver`
 *   applies them there to a real meter.
 */
import type { Meter } from "./meter.js";

export type { Attributes, AttributeValue, Counter, Histogram, InstrumentAdvice, InstrumentOptions, Meter } from "./meter.js";
export { createNoopMeter } from "./noop-meter.js";
export {
    createForwardingMeter,
    createMeterReceiver,
    type ForwardedInstrument,
    type ForwardedMetricMessage,
    type ForwardedRecords,
    type ForwardingMeter,
    type ForwardingMeterOptions,
    type MessageTarget,
} from "./forwarding-meter.js";

/**
 * This function gives one meter that records into each meter of a list. Each
 * instrument of the result makes the instrument of the same name in each
 * meter. A record goes to each meter in the order of the list.
 *
 * ```ts
 * const meter = fanOutMeter(api.metrics.getMeter("lag"), hudMeter);
 * ```
 */
export function fanOutMeter(...meters : readonly Meter[]) : Meter {
    return {
        createHistogram : (name, options) => {
            const all = meters.map((meter) => meter.createHistogram(name, options));
            return {
                record : (value, attributes) => {
                    for (const histogram of all) histogram.record(value, attributes);
                },
            };
        },
        createCounter : (name, options) => {
            const all = meters.map((meter) => meter.createCounter(name, options));
            return {
                add : (value, attributes) => {
                    for (const counter of all) counter.add(value, attributes);
                },
            };
        },
    };
}
