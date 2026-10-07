/**
 * The site mark: a strip of frames. Each tick is one frame at 60 Hz; the red
 * one is a frame that the main thread was too busy to deliver.
 */
export function BrandMark() {
    return (
        <svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true" focusable="false">
            <path d="M1 20.5h24" stroke="var(--color-ink-muted)" strokeWidth="1" />
            <rect x="2" y="12" width="3" height="8" rx="1" fill="var(--color-ink)" />
            <rect x="7" y="12" width="3" height="8" rx="1" fill="var(--color-ink)" />
            <rect x="12" y="3" width="3" height="17" rx="1" fill="var(--color-mark)" />
            <rect x="17" y="12" width="3" height="8" rx="1" fill="var(--color-ink)" />
            <rect x="22" y="12" width="3" height="8" rx="1" fill="var(--color-ink)" />
        </svg>
    );
}
