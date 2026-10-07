import { useEffect, useState, useSyncExternalStore } from "react";
import type { PlaygroundSession, PlaygroundSnapshot, SessionKind } from "./session";
import { useSessionFactory } from "./SessionFactoryContext";

export type SessionState = {
    session : PlaygroundSession | undefined;
    /** Undefined until the session exists. */
    snapshot : PlaygroundSnapshot | undefined;
    error : Error | undefined;
};

const noSubscription = () : (() => void) => () => {};
const noSnapshot = () : undefined => undefined;

/**
 * Makes a session for the life of the component. The component starts and
 * stops it. On unmount, the hook disposes the session: the monitors stop and
 * the worker terminates.
 */
export function useSession(kind : SessionKind) : SessionState {
    const factory = useSessionFactory();
    const [session, setSession] = useState<PlaygroundSession>();
    const [error, setError] = useState<Error>();

    useEffect(() => {
        let disposed = false;
        let created : PlaygroundSession | undefined;
        factory(kind).then(
            (next) => {
                if (disposed) {
                    next.dispose();
                    return;
                }
                created = next;
                setSession(next);
            },
            (reason : unknown) => {
                if (!disposed) setError(reason instanceof Error ? reason : new Error(String(reason)));
            },
        );
        return () => {
            disposed = true;
            created?.dispose();
        };
    }, [factory, kind]);

    const snapshot = useSyncExternalStore(
        session?.subscribe ?? noSubscription,
        session?.getSnapshot ?? noSnapshot,
        session?.getSnapshot ?? noSnapshot,
    );
    return { session, snapshot, error };
}
