import type { MDXComponents } from "mdx/types";
import { createElement, lazy, Suspense, type ComponentType } from "react";
import { Callout } from "../components/Callout/Callout";
import { Figure } from "../components/Figure/Figure";
import { MdxLink } from "../components/MdxLink/MdxLink";
import { Mermaid } from "../components/Mermaid/Mermaid";
import { MetricTable } from "../components/MetricTable/MetricTable";
import { PlotFigure } from "../components/PlotFigure/PlotFigure";
import { MarkdownTable } from "../components/ScrollTable/ScrollTable";
import { SupportMatrix } from "../components/SupportMatrix/SupportMatrix";
import { Tab, Tabs } from "../components/Tabs/Tabs";

/** Wraps a large component so its code loads only when a page uses it. */
function lazyComponent<P extends object>(
    load : () => Promise<{ default : ComponentType<P> }>,
    loadingText : string,
) : ComponentType<P> {
    const Lazy = lazy(load);
    function LazyComponent(props : P) {
        return (
            <Suspense fallback={<p aria-busy="true">{loadingText}</p>}>
                {createElement(Lazy, props)}
            </Suspense>
        );
    }
    return LazyComponent;
}

const ArchitectureMap = lazyComponent(
    () => import("../components/ArchitectureMap/ArchitectureMap"),
    "Loading the architecture map.",
);

/**
 * The components that MDX pages can use without an import. To add a
 * component, import it and add one line here.
 */
export const mdxComponents = {
    // Overrides of Markdown elements
    a : MdxLink,
    table : MarkdownTable,

    // Components, in alphabetical order
    ArchitectureMap,
    Callout,
    Figure,
    Mermaid,
    MetricTable,
    PlotFigure,
    SupportMatrix,
    Tab,
    Tabs,
} satisfies MDXComponents;
