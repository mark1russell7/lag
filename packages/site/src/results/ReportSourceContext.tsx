import { createContext, useContext, type ReactNode } from "react";
import type { ReportSource } from "./report-source";

const ReportSourceContext = createContext<ReportSource | undefined>(undefined);

export function ReportSourceProvider({ source, children } : { source : ReportSource; children : ReactNode }) {
    return <ReportSourceContext value={source}>{children}</ReportSourceContext>;
}

export function useReportSource() : ReportSource {
    const source = useContext(ReportSourceContext);
    if (!source) throw new Error("useReportSource() needs a ReportSourceProvider.");
    return source;
}
