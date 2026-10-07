import { createContext, useContext, type ReactNode } from "react";
import type { PlaygroundSession, SessionKind } from "./session";

/** This function makes a session. It is async, so that the monitor code loads only when a page needs it. */
export type SessionFactory = (kind : SessionKind) => Promise<PlaygroundSession>;

const SessionFactoryContext = createContext<SessionFactory | undefined>(undefined);

export function SessionFactoryProvider({ factory, children } : { factory : SessionFactory; children : ReactNode }) {
    return <SessionFactoryContext value={factory}>{children}</SessionFactoryContext>;
}

export function useSessionFactory() : SessionFactory {
    const factory = useContext(SessionFactoryContext);
    if (!factory) throw new Error("useSessionFactory() needs a SessionFactoryProvider.");
    return factory;
}
