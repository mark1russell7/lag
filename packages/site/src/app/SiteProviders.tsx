import type { ReactNode } from "react";
import { ContentRegistryProvider } from "../content/ContentRegistryContext";
import type { ContentRegistry } from "../content/types";
import { SessionFactoryProvider, type SessionFactory } from "../playground/SessionFactoryContext";
import type { ReportSource } from "../results/report-source";
import { ReportSourceProvider } from "../results/ReportSourceContext";
import { PreferenceStoreProvider } from "../theme/PreferenceStoreContext";
import type { PreferenceStore } from "../theme/preferences";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { SiteSection } from "./section-types";
import { SectionsProvider } from "./SectionsContext";

/** Everything that the components get from outside. Tests give their own values. */
export type SiteServices = {
    sections : readonly SiteSection[];
    content : ContentRegistry;
    reports : ReportSource;
    preferences : PreferenceStore;
    sessions : SessionFactory;
};

export function SiteProviders({ services, children } : { services : SiteServices; children : ReactNode }) {
    return (
        <PreferenceStoreProvider store={services.preferences}>
            <ThemeProvider store={services.preferences}>
                <SectionsProvider sections={services.sections}>
                    <ContentRegistryProvider registry={services.content}>
                        <ReportSourceProvider source={services.reports}>
                            <SessionFactoryProvider factory={services.sessions}>
                                {children}
                            </SessionFactoryProvider>
                        </ReportSourceProvider>
                    </ContentRegistryProvider>
                </SectionsProvider>
            </ThemeProvider>
        </PreferenceStoreProvider>
    );
}
