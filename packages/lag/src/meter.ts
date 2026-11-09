/**
 * The `Meter` that this package records into: a narrow form of the `Meter` of
 * `@opentelemetry/api`.
 *
 * The value types come from `@opentelemetry/api` as types only, so the bundle
 * gets no code from it. The `Meter` type has only the two instruments that
 * this package uses. You can use any object with this shape: the real OTel
 * `Meter`, a no-op meter for tests, or a mock that records the values.
 *
 * The package uses only counters and histograms. The values of both
 * aggregate correctly across many browsers. The values of a gauge do not.
 * The value from one browser has no meaning for a fleet. Also, with
 * cumulative temporality, the OTel SDK sends the last value again when a
 * callback no longer observes it.
 */
import type * as api from "@opentelemetry/api";

/** `AttributeValue` of `@opentelemetry/api`: a primitive, or an array of primitives of one type. */
export type AttributeValue = api.AttributeValue;

/** `Attributes` of `@opentelemetry/api` */
export type Attributes = api.Attributes;

/** The method `record` of a `Histogram` of `@opentelemetry/api` */
export type Histogram<A extends Attributes = Attributes> = Pick<api.Histogram<A>, "record">;

/** The method `add` of a `Counter` of `@opentelemetry/api` */
export type Counter<A extends Attributes = Attributes> = Pick<api.Counter<A>, "add">;

/**
 * `MetricAdvice` of `@opentelemetry/api`. The SDK uses
 * `explicitBucketBoundaries` when it records a histogram with explicit
 * buckets. A view can replace the advice. The SDK ignores the advice for an
 * exponential histogram.
 */
export type InstrumentAdvice = api.MetricAdvice;

/** `MetricOptions` of `@opentelemetry/api`. This package gives a unit to each instrument. */
export type InstrumentOptions = api.MetricOptions & { unit : string };

/** The two instruments of a `Meter` of `@opentelemetry/api` that this package uses */
export type Meter = {
    createHistogram<A extends Attributes = Attributes>(name : string, options : InstrumentOptions) : Histogram<A>;
    createCounter<A extends Attributes = Attributes>(name : string, options : InstrumentOptions) : Counter<A>;
};
