/**
 * The readiness rule of the site.
 *
 * A component that loads code or data shows a placeholder with
 * `aria-busy="true"`. A page is ready when no element in the page has this
 * attribute. The smoke test of the routes uses the same rule.
 *
 * - The build waits for a ready page before it keeps the HTML of the page.
 *   Refer to `build/prerender.ts`.
 * - In a page with HTML from the build, the app renders into a hidden
 *   element. It shows that element when the page is ready. Refer to
 *   `app/prerender-handoff.ts`.
 *
 * Give `aria-busy` only while the placeholder shows. React writes
 * `aria-busy={false}` as the text "false", and the rule ignores it.
 */
export const LOADING_SELECTOR = "[aria-busy=\"true\"]";

/** The attribute of the root element when the root element contains HTML from the build. Its value is the route of the HTML. */
export const PRERENDERED_ATTRIBUTE = "data-prerendered";

/**
 * The global flag that the prerender of the build sets before the app
 * starts. With the flag, the app does not start the live monitors. Thus the
 * HTML of a page does not contain the readings of the build machine.
 */
export const PRERENDER_FLAG = "__lagPrerender";
