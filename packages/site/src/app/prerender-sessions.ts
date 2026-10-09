import type { SessionFactory } from "../playground/SessionFactoryContext";

/**
 * This function gives a session factory for the prerender of the build. Its
 * sessions do not start. Thus the HTML of the playground and of the home
 * page shows the controls and the empty charts. It does not show the
 * readings of the build machine. The app in the browser of the reader uses
 * the usual factory, and its sessions start.
 */
export function sessionsWithoutStart(inner : SessionFactory) : SessionFactory {
    return kind => inner(kind).then((session) => {
        // The method of the instance hides the method of the class.
        session.start = () => {};
        return session;
    });
}
