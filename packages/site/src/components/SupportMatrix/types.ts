export type SupportStatus = "supported" | "partial" | "unsupported" | "unknown";

export type SupportCell = {
    status : SupportStatus;
    /** The first version with this status, for example "123". */
    version? : string;
    /** IDs of footnotes that apply to this cell. */
    notes? : readonly string[];
};

export type SupportBrowser = {
    id : string;
    label : string;
};

export type SupportRow = {
    feature : string;
    /** The API name, for example `PerformanceObserver` with `long-animation-frame`. */
    api? : string;
    /** One cell per browser ID. A missing cell shows as "unknown". */
    cells : Readonly<Record<string, SupportCell>>;
};

export type SupportFootnote = {
    id : string;
    text : string;
};
