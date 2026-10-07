import type {
    Attributes,
    Counter,
    Histogram,
    Meter,
    ObservableCallback,
    ObservableGauge,
} from "../adapters/lag-core";
import { RingBuffer } from "./ring-buffer";

export type InstrumentKind = "histogram" | "counter" | "gauge";

export type MeterSample = {
    /** The clock time of the sample, in ms. */
    t : number;
    value : number;
    attributes? : Readonly<Attributes>;
};

export type InstrumentReading = {
    name : string;
    kind : InstrumentKind;
    unit : string;
    /** The number of values since the meter started. */
    count : number;
    /** The sum of the values since the meter started (for a counter, its value). */
    total : number;
    /** The newest samples, oldest first. */
    samples : readonly MeterSample[];
};

class Instrument {
    readonly buffer : RingBuffer<MeterSample>;
    count = 0;
    total = 0;

    constructor(readonly name : string, readonly kind : InstrumentKind, readonly unit : string, capacity : number) {
        this.buffer = new RingBuffer(capacity);
    }

    add(sample : MeterSample) : void {
        this.buffer.push(sample);
        this.count++;
        this.total += sample.value;
    }
}

export type LiveMeterOptions = {
    /** The clock for sample times, in ms. */
    now : () => number;
    /** Samples to keep for each instrument. */
    capacity? : number;
};

/**
 * A `Meter` that keeps the recent values in the page, so the playground can
 * show them. Each instrument keeps its newest samples in a ring buffer.
 * Observable gauges report when `collect()` runs, as at each export of a
 * metric reader.
 */
export class LiveMeter implements Meter {
    private readonly instruments = new Map<string, Instrument>();
    private readonly gaugeCallbacks = new Map<string, Set<ObservableCallback>>();
    private readonly capacity : number;

    constructor(private readonly options : LiveMeterOptions) {
        this.capacity = options.capacity ?? 4096;
    }

    createHistogram<A extends Attributes = Attributes>(name : string, options : { unit : string }) : Histogram<A> {
        const instrument = this.instrument(name, "histogram", options.unit);
        return { record : (value, attributes) => instrument.add(this.sample(value, attributes)) };
    }

    createCounter<A extends Attributes = Attributes>(name : string, options : { unit : string }) : Counter<A> {
        const instrument = this.instrument(name, "counter", options.unit);
        return { add : (value, attributes) => instrument.add(this.sample(value, attributes)) };
    }

    createObservableGauge<A extends Attributes = Attributes>(name : string, options : { unit : string }) : ObservableGauge<A> {
        this.instrument(name, "gauge", options.unit);
        let callbacks = this.gaugeCallbacks.get(name);
        if (!callbacks) {
            callbacks = new Set();
            this.gaugeCallbacks.set(name, callbacks);
        }
        const registered = callbacks as Set<ObservableCallback<A>>;
        return {
            addCallback : (callback) => { registered.add(callback); },
            removeCallback : (callback) => { registered.delete(callback); },
        };
    }

    /** Calls every gauge callback once. An error in one callback does not stop the others. */
    collect() : void {
        for (const [name, callbacks] of this.gaugeCallbacks) {
            const instrument = this.instruments.get(name);
            if (!instrument) continue;
            for (const callback of callbacks) {
                try {
                    callback({ observe : (value, attributes) => instrument.add(this.sample(value, attributes)) });
                } catch {
                    // A failed callback reports nothing for this collection.
                }
            }
        }
    }

    /** The number of registered gauge callbacks. After the monitors stop, it must be 0. */
    callbackCount() : number {
        let count = 0;
        for (const callbacks of this.gaugeCallbacks.values()) count += callbacks.size;
        return count;
    }

    read(name : string) : InstrumentReading | undefined {
        const instrument = this.instruments.get(name);
        if (!instrument) return undefined;
        return {
            name,
            kind : instrument.kind,
            unit : instrument.unit,
            count : instrument.count,
            total : instrument.total,
            samples : instrument.buffer.toArray(),
        };
    }

    /** The samples of an instrument from time `since` (ms) to now. */
    samplesSince(name : string, since : number) : MeterSample[] {
        return this.instruments.get(name)?.buffer.newest(sample => sample.t >= since) ?? [];
    }

    /** The newest sample of an instrument. */
    latest(name : string) : MeterSample | undefined {
        return this.instruments.get(name)?.buffer.latest();
    }

    names() : string[] {
        return [...this.instruments.keys()].sort();
    }

    private instrument(name : string, kind : InstrumentKind, unit : string) : Instrument {
        let instrument = this.instruments.get(name);
        if (!instrument) {
            instrument = new Instrument(name, kind, unit, this.capacity);
            this.instruments.set(name, instrument);
        }
        return instrument;
    }

    private sample(value : number, attributes : Attributes | undefined) : MeterSample {
        const sample : MeterSample = { t : this.options.now(), value };
        if (attributes) sample.attributes = attributes;
        return sample;
    }
}
