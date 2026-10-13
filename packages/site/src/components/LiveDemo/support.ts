import {
    frameRows,
    interactionRows,
    isolationRows,
    navigationRows,
    paintRows,
    schedulingRows,
    supportColumns,
    timeRows,
} from "../../../content/research/browser-support.data";

const SUPPORT_ROWS = [...frameRows, ...interactionRows, ...paintRows, ...navigationRows, ...schedulingRows, ...isolationRows, ...timeRows];

/**
 * The browsers that have a feature, from the browser support page, for
 * example "Chrome and Edge 123 and later. Firefox: no. Safari: no.".
 */
export function supportSummary(feature : string) : string | undefined {
    const row = SUPPORT_ROWS.find(candidate => candidate.feature === feature);
    if (!row) return undefined;
    const parts = supportColumns.filter(column => column.id !== "worker").map((column) => {
        const cell = row.cells[column.id];
        switch (cell?.status) {
            case "supported": return cell.version ? `${column.label} ${cell.version} and later` : `${column.label}: yes`;
            case "partial": return cell.version ? `${column.label} ${cell.version} and later, in part` : `${column.label}: in part`;
            case "unsupported": return `${column.label}: no`;
            default: return `${column.label}: unknown`;
        }
    });
    return `${parts.join(". ")}.`;
}
