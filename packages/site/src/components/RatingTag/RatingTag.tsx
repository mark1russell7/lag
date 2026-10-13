import styles from "./RatingTag.module.css";

export type Rating = "good" | "needs-improvement" | "poor";

const LABELS : Readonly<Record<Rating, string>> = {
    "good" : "Good",
    "needs-improvement" : "Needs improvement",
    "poor" : "Poor",
};

function Shape({ rating } : { rating : Rating }) {
    switch (rating) {
        case "good":
            return <path d="M5 10.5 8.5 14 15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;
        case "needs-improvement":
            return <path d="M10 4.5v7M10 15v.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />;
        case "poor":
            return <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />;
    }
}

/** The rating of a Web Vital, with the thresholds of web-vitals. A shape and a label show it, not only a color. */
export function RatingTag({ rating, prefix } : { rating : Rating; prefix? : string }) {
    return (
        <span className={styles.tag} data-rating={rating}>
            <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <Shape rating={rating} />
            </svg>
            <span>{prefix ? `${prefix} ` : ""}{LABELS[rating].toLowerCase()}</span>
        </span>
    );
}
