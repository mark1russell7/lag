/**
 * Duck-typed OpenTelemetry Meter interface.
 *
 * Structural subset of `@opentelemetry/api`'s Meter that covers only the
 * instruments this package uses. Any object with this shape works: the real
 * OTel Meter, a no-op for tests, or a recording mock.
 *
 * The package uses only counters and histograms. Both aggregate correctly
 * across many browsers. A gauge does not: the value from one browser has no
 * meaning for a fleet, and under cumulative temporality the OTel SDK sends
 * the last value again after a callback stops observing it.
 */

/** Mirrors `@opentelemetry/api`'s AttributeValue: primitives or homogeneous primitive arrays. */
export type AttributeValue =
    | string
    | number
    | boolean
    | Array<null | undefined | string>
    | Array<null | undefined | number>
    | Array<null | undefined | boolean>;

/** Mirrors `@opentelemetry/api`'s Attributes. */
export type Attributes = { [key : string] : AttributeValue | undefined };

export type Histogram<A extends Attributes = Attributes> = {
    record(value : number, attributes? : A) : void;
};

export type Counter<A extends Attributes = Attributes> = {
    add(value : number, attributes? : A) : void;
};

export type InstrumentOptions = {
    unit : string;
    description? : string;
};

export type Meter = {
    createHistogram<A extends Attributes = Attributes>(name : string, options : InstrumentOptions) : Histogram<A>;
    createCounter<A extends Attributes = Attributes>(name : string, options : InstrumentOptions) : Counter<A>;
};
