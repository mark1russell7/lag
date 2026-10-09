import type { Attributes, InstrumentOptions, Meter } from "./meter.js";
import { createRandomId } from "./random-id.js";
import type { ClearIntervalFn, SetIntervalFn } from "./types.js";

/**
 * A `Meter` that sends its records to a different context, usually a worker
 * that hosts the OpenTelemetry SDK. Thus, the aggregation, the encoding and
 * the export do not occur on the main thread.
 *
 * The forwarding meter sends the records in batches: one batch each
 * `flushIntervalMs`, and one batch when the buffer is full. A batch also
 * contains the definition of each instrument whose first record is in the
 * batch. Thus a receiver that starts to listen after the creation of the
 * instruments still gets them. The other side applies the batches to a real
 * `Meter` with `createMeterReceiver`.
 */

/** The definition of one instrument of a forwarding meter. */
export type ForwardedInstrument = {
    id : number;
    kind : "histogram" | "counter";
    name : string;
    options : InstrumentOptions;
};

/** One batch of one forwarding meter. Each record is `[instrument id, value, attributes]`. */
export type ForwardedRecords = {
    type : "records";
    /**
     * The ID of the forwarding meter. The instrument IDs are unique only in
     * one forwarding meter, thus the receiver keeps the instruments of each
     * sender apart.
     */
    sender : string;
    /** The definitions of the instruments whose first records are in this batch. */
    instruments : ForwardedInstrument[];
    records : Array<[number, number, Attributes | undefined]>;
};

export type ForwardedMetricMessage = ForwardedRecords;

export type MessageTarget = {
    postMessage(message : ForwardedMetricMessage) : void;
};

export type ForwardingMeter = {
    readonly meter : Meter;
    /** This method sends the buffered records immediately. */
    flush() : void;
    /**
     * This method sends the buffered records and stops the flush timer. After
     * it, the meter ignores all records.
     */
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
    /** The ID of this sender in each batch. The default is a new random ID. */
    senderId? : string;
};

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_MAX_BUFFERED_RECORDS = 500;

export function createForwardingMeter(target : MessageTarget, options : ForwardingMeterOptions) : ForwardingMeter {
    const maxBuffered = options.maxBufferedRecords ?? DEFAULT_MAX_BUFFERED_RECORDS;
    const sender = options.senderId ?? createRandomId();
    let nextId = 1;
    let disposed = false;
    let buffer : ForwardedRecords["records"] = [];
    let announcements : ForwardedInstrument[] = [];

    const flush = () : void => {
        if (buffer.length === 0) return;
        const message : ForwardedRecords = { type : "records", sender, instruments : announcements, records : buffer };
        buffer = [];
        announcements = [];
        target.postMessage(message);
    };

    const register = (kind : ForwardedInstrument["kind"], name : string, instrumentOptions : InstrumentOptions) => {
        const instrument : ForwardedInstrument = { id : nextId++, kind, name, options : instrumentOptions };
        let announced = false;
        return (value : number, attributes? : Attributes) => {
            if (disposed) return;
            // The definition goes with the first record, in the same batch
            if (!announced) {
                announced = true;
                announcements.push(instrument);
            }
            buffer.push([instrument.id, value, attributes]);
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
            disposed = true;
            options.clearIntervalFn(handle);
        },
    };
}

type Recorder = (value : number, attributes? : Attributes) => void;

function createRecorder(meter : Meter, instrument : ForwardedInstrument) : Recorder {
    if (instrument.kind === "histogram") {
        const histogram = meter.createHistogram(instrument.name, instrument.options);
        return (value, attributes) => histogram.record(value, attributes);
    }
    const counter = meter.createCounter(instrument.name, instrument.options);
    return (value, attributes) => counter.add(value, attributes);
}

/**
 * This function makes the receiving side. The receiver applies the forwarded
 * batches to `meter`, for example to the OpenTelemetry `Meter` in a worker.
 * One receiver can take the batches of many forwarding meters. It ignores the
 * records of an unknown instrument.
 */
export function createMeterReceiver(meter : Meter) : { handleMessage(message : ForwardedMetricMessage) : void } {
    const senders = new Map<string, Map<number, Recorder>>();
    return {
        handleMessage(message) {
            const instruments = senders.get(message.sender) ?? new Map<number, Recorder>();
            senders.set(message.sender, instruments);
            for (const instrument of message.instruments) {
                if (!instruments.has(instrument.id)) instruments.set(instrument.id, createRecorder(meter, instrument));
            }
            for (const [id, value, attributes] of message.records) {
                instruments.get(id)?.(value, attributes);
            }
        },
    };
}
