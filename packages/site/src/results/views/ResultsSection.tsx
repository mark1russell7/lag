import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { useStoredFlag } from "../../theme/PreferenceStoreContext";
import type { ReportSource } from "../report-source";
import { ReportSourceProvider, useReportSource } from "../ReportSourceContext";
import styles from "./Results.module.css";

// Only the development build has the sample data. In a production build,
// `import.meta.env.DEV` is false, so the bundler removes the fixture.
const loadSampleSource : (() => Promise<ReportSource>) | undefined = import.meta.env.DEV
    ? () => import("../../fixtures/sample-results").then(module => module.createSampleReportSource())
    : undefined;

const SAMPLE_KEY = "lag-site:results-sample";

function SampleToggle({ checked, onChange } : { checked : boolean; onChange : (value : boolean) => void }) {
    return (
        <div className={styles.devBar}>
            <label className={styles.devToggle}>
                <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
                Show sample data
            </label>
            <span className={styles.devNote}>Development only. The sample data is not a real run.</span>
        </div>
    );
}

/** The results section. In development, it can replace the data with the sample runs. */
export function ResultsSection() {
    const source = useReportSource();
    const [useSample, setUseSample] = useStoredFlag(SAMPLE_KEY, false);
    const [sampleSource, setSampleSource] = useState<ReportSource>();

    useEffect(() => {
        if (!useSample || sampleSource || !loadSampleSource) return;
        let current = true;
        void loadSampleSource().then((loaded) => { if (current) setSampleSource(loaded); });
        return () => { current = false; };
    }, [useSample, sampleSource]);

    const active = useSample && sampleSource ? sampleSource : source;
    return (
        <ReportSourceProvider source={active}>
            <div className={styles.section}>
                {loadSampleSource ? <SampleToggle checked={useSample} onChange={setUseSample} /> : null}
                <Outlet />
            </div>
        </ReportSourceProvider>
    );
}
