/** The DOM node fields that the selector reads. Real DOM nodes have them. */
type NodeLike = {
    nodeType? : number;
    nodeName? : string;
    id? : string;
    classList? : Iterable<string>;
    parentNode? : NodeLike | null;
};

const ELEMENT_NODE = 1;
const DOCUMENT_NODE = 9;
const DEFAULT_MAX_LENGTH = 100;

function nodeName(node : NodeLike) : string {
    const name = node.nodeName ?? "";
    return node.nodeType === ELEMENT_NODE ? name.toLowerCase() : name.toUpperCase().replace(/^#/, "");
}

/**
 * Makes a short CSS-like selector for a DOM node, as web-vitals does: `#id`
 * (and stop), or `tag.class1.class2` with sorted classes, joined with `>`
 * from the root down, at most `maxLength` characters.
 *
 * The selector is for events only. It identifies elements, so it must never
 * be a metric attribute.
 */
export function describeNode(node : unknown, maxLength : number = DEFAULT_MAX_LENGTH) : string {
    let selector = "";
    let current = node as NodeLike | null | undefined;
    try {
        while (current && current.nodeType !== DOCUMENT_NODE) {
            const part = current.id
                ? `#${current.id}`
                : [nodeName(current), ...Array.from(current.classList ?? []).sort()].join(".");
            if (selector.length + part.length > maxLength - 1) return selector || part;
            selector = selector ? `${part}>${selector}` : part;
            if (current.id) break;
            current = current.parentNode;
        }
    } catch {
        // A detached or unusual node: keep what there is
    }
    return selector;
}
