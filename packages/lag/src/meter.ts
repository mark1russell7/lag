/**
 * Duck-typed OpenTelemetry Meter interface.
 *
 * Structural subset of `@opentelemetry/api`'s Meter that covers only the
 * instruments this package uses. Any object implementing this shape works —
 * the real OTel Meter, a noop for testing, or a recording mock.
 *
 * Kept as a duck type (not an import) to:
 * - Let this package stay environment-agnostic (no OTel dep in core)
 * - Allow consumers to provide minimal test doubles
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

export type ObservableResult<A extends Attributes = Attributes> = {
    observe(value : number, attributes? : A) : void;
};

export type ObservableCallback<A extends Attributes = Attributes> = (observableResult : ObservableResult<A>) => void;

export type Histogram<A extends Attributes = Attributes> = {
    record(value : number, attributes? : A) : void;
};

export type Counter<A extends Attributes = Attributes> = {
    add(value : number, attributes? : A) : void;
};

export type ObservableGauge<A extends Attributes = Attributes> = {
    addCallback(callback : ObservableCallback<A>) : void;
    removeCallback(callback : ObservableCallback<A>) : void;
};

export type Meter = {
    createHistogram<A extends Attributes = Attributes>(
        name : string,
        options : { unit : string },
    ) : Histogram<A>;

    createCounter<A extends Attributes = Attributes>(
        name : string,
        options : { unit : string },
    ) : Counter<A>;

    createObservableGauge<A extends Attributes = Attributes>(
        name : string,
        options : { unit : string },
    ) : ObservableGauge<A>;
};
