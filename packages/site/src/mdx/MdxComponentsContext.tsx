import type { MDXComponents } from "mdx/types";
import { createContext, useContext, type ReactNode } from "react";
import { mdxComponents } from "./component-map";

const MdxComponentsContext = createContext<MDXComponents>(mdxComponents);

/** Replaces the MDX components for part of the tree (for example in a test). */
export function MdxComponentsProvider({ components, children } : { components : MDXComponents; children : ReactNode }) {
    return <MdxComponentsContext value={components}>{children}</MdxComponentsContext>;
}

export function useMdxComponents() : MDXComponents {
    return useContext(MdxComponentsContext);
}
