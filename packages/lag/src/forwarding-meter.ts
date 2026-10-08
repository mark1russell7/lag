import type { Attributes, InstrumentOptions, Meter } from "./meter.js";
import type { ClearIntervalFn, SetIntervalFn } from "./types.js";

/**
 * A `Meter` that sends its records to a different context, usually a worker
 * that hosts the OpenTelemetry SDK. Thus, the aggregation, the encoding and
 * the export do not occur on the main thread.
 *
 * The forwarding meter sends one message for each instrument that it makes.
 * It sends the records in batches: one batch each `flushIntervalMs`, and one
 * batch when the buffer is full. The other side applies the messages to a
 * real `Meter` with `createMeterReceiver`.
 */

export type ForwardedInstrument = {
    type : "instrument";
    id : number;
    kind : "histogram" | "counter";
    name : string;
    options : InstrumentOptions;
};

/** Each record is `[instrument id, value, attributes]`. */
export type ForwardedRecords = {
    type : "records";
    records : Array<[number, number, Attributes | undefined]>;
};

export type ForwardedMetricMessage = ForwardedInstrument | ForwardedRecords;

export type MessageTarget = {
    postMessage(message : ForwardedMetricMessage) : void;
};

export type ForwardingMeter = {
    readonly meter : Meter;
    /** This method sends the buffered records immediately. */
    flush() : void;
    /** This method sends the buffered records and stops the flush timer. */
    dispose() : void;
};

export type ForwardingMeterOptions = {
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
    /** The default is 1000 ms. */
    flushIntervalMs? : number;
    /**
     * When the buffer has this number of records, the meter sends them
     * immediately. The default is 500.
     */
    maxBufferedRecords? : number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_MAX_BUFFERED_RECORDS = 500;

export function createForwardingMeter(target : MessageTarget, options : ForwardingMeterOptions) : ForwardingMeter {
    const maxBuffered = options.maxBufferedRecords ?? DEFAULT_MAX_BUFFERED_RECORDS;
    let nextId = 1;
    let buffer : ForwardedRecords["records"] = [];

    const flush = () : void => {
        if (buffer.length === 0) return;
        const records = buffer;
        buffer = [];
        target.postMessage({ type : "records", records });
    };

    const register = (kind : ForwardedInstrument["kind"], name : string, instrumentOptions : InstrumentOptions) => {
        const id = nextId++;
        target.postMessage({ type : "instrument", id, kind, name, options : instrumentOptions });
        return (value : number, attributes? : Attributes) => {
            buffer.push([id, value, attributes]);
            if (buffer.length >= maxBuffered) flush();
        };
    };

    const meter : Meter = {
        createHistogram : (name, instrumentOptions) => ({ record : register("histogram", name, instrumentOptions) }),
        createCounter : (name, instrumentOptions) => ({ add : register("counter", name, instrumentOptions) }),
    };

    const handle = options.setIntervalFn(flush, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);

    return {
        meter,
        flush,
        dispose() {
            flush();
            options.clearIntervalFn(handle);
        },
    };
}

/**
 * This function makes the receiving side. The receiver applies the forwarded
 * messages to `meter`, for example to the OpenTelemetry `Meter` in a worker.
 * It ignores the records of an unknown instrument ID.
 */
export function createMeterReceiver(meter : Meter) : { handleMessage(message : ForwardedMetricMessage) : void } {
    const instruments = new Map<number, (value : number, attributes? : Attributes) => void>();
    return {
        handleMessage(message) {
            if (message.type === "instrument") {
                if (message.kind === "histogram") {
                    const histogram = meter.createHistogram(message.name, message.options);
                    instruments.set(message.id, (v, a) => histogram.record(v, a));
                } else {
                    const counter = meter.createCounter(message.name, message.options);
                    instruments.set(message.id, (v, a) => counter.add(v, a));
                }
                return;
            }
            for (const [id, value, attributes] of message.records) {
                instruments.get(id)?.(value, attributes);
            }
        },
    };
}
