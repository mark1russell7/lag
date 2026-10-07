import { StatusIcon, type StatusKind } from "../../components/StatusIcon/StatusIcon";
import styles from "./ChartLegend.module.css";

export type LegendItem = {
    label : string;
    color : string;
    /** A square for bars and areas, a line for lines. */
    shape? : "square" | "line";
    /** The dash pattern of a line, as SVG `stroke-dasharray`. */
    dash? : string;
    /** Shows the status icon and its label instead of `label`. */
    kind? : StatusKind;
};

/** The legend of a chart. Each item has a swatch and a text label, so it does not depend on color alone. */
export function ChartLegend({ items, label } : { items : readonly LegendItem[]; label : string }) {
    return (
        <ul className={styles.legend} aria-label={label}>
            {items.map(item => (
                <li key={item.label} className={styles.item}>
                    <svg className={styles.swatch} viewBox="0 0 24 12" aria-hidden="true" focusable="false">
                        {item.shape === "line"
                            ? <line x1="1" y1="6" x2="23" y2="6" stroke={item.color} strokeWidth="2.5" strokeDasharray={item.dash} strokeLinecap="round" />
                            : <rect x="6" y="0" width="12" height="12" rx="2" fill={item.color} />}
                    </svg>
                    {item.kind ? <StatusIcon kind={item.kind} /> : <span>{item.label}</span>}
                </li>
            ))}
        </ul>
    );
}
