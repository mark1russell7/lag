/**
 * A duck-typed interface for the OpenTelemetry `Meter`.
 *
 * These types are a structural subset of the `Meter` of `@opentelemetry/api`.
 * They cover only the instruments that this package uses. You can use any
 * object with this shape: the real OTel `Meter`, a no-op meter for tests, or
 * a mock that records the values.
 *
 * The package uses only counters and histograms. The values of both
 * aggregate correctly across many browsers. The values of a gauge do not.
 * The value from one browser has no meaning for a fleet. Also, with
 * cumulative temporality, the OTel SDK sends the last value again when a
 * callback no longer observes it.
 */

/**
 * The same type as `AttributeValue` of `@opentelemetry/api`. A value is a
 * primitive, or an array of primitives of one type.
 */
export type AttributeValue =
    | string
    | number
    | boolean
    | Array<null | undefined | string>
    | Array<null | undefined | number>
    | Array<null | undefined | boolean>;

/** The same type as `Attributes` of `@opentelemetry/api`. */
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
