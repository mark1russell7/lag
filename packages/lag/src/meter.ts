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

export type ObservableResult<A = Record<string, unknown>> = {
    observe(value : number, attributes? : A) : void;
};

export type Histogram<A = Record<string, unknown>> = {
    record(value : number, attributes? : A) : void;
};

export type ObservableGauge<A = Record<string, unknown>> = {
    addCallback(callback : (observableResult : ObservableResult<A>) => void) : void;
};

export type Meter = {
    createHistogram<A = Record<string, unknown>>(
        name : string,
        options : { unit : string },
    ) : Histogram<A>;

    createObservableGauge<A = Record<string, unknown>>(
        name : string,
        options : { unit : string },
    ) : ObservableGauge<A>;
};
