import { useEffect, useMemo, useState } from "react";
import { highlight } from "./code";
import styles from "./Home.module.css";

type CopyState = "idle" | "copied" | "failed";

function useCopy(text : string) : [CopyState, () => void] {
    const [state, setState] = useState<CopyState>("idle");
    useEffect(() => {
        if (state === "idle") return undefined;
        const timer = window.setTimeout(() => setState("idle"), 2000);
        return () => window.clearTimeout(timer);
    }, [state]);
    const copy = () : void => {
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
        if (!clipboard) {
            setState("failed");
            return;
        }
        clipboard.writeText(text).then(() => setState("copied"), () => setState("failed"));
    };
    return [state, copy];
}

const COPY_TEXT : Readonly<Record<CopyState, string>> = { idle : "Copy", copied : "Copied", failed : "Select and copy the text" };

function CopyButton({ text, label } : { text : string; label : string }) {
    const [state, copy] = useCopy(text);
    return (
        <>
            <button type="button" className={styles.copy} onClick={copy} aria-label={state === "idle" ? label : COPY_TEXT[state]}>
                {COPY_TEXT[state]}
            </button>
            <span className="visually-hidden" role="status">{state === "copied" ? "The text is on the clipboard." : ""}</span>
        </>
    );
}

/** One shell command with a copy button. */
export function CommandLine({ command } : { command : string }) {
    return (
        <div className={styles.command}>
            <code><span className={styles.prompt} aria-hidden="true">$ </span>{command}</code>
            <CopyButton text={command} label="Copy the command" />
        </div>
    );
}

/** A block of TypeScript with a small highlighter and a copy button. */
export function CodeBlock({ code, title } : { code : string; title : string }) {
    const tokens = useMemo(() => highlight(code), [code]);
    return (
        <figure className={styles.code}>
            <figcaption className={styles.codeTitle}>
                <span>{title}</span>
                <CopyButton text={code} label="Copy the code" />
            </figcaption>
            <pre tabIndex={0}><code>{tokens.map((token, index) => (
                token.kind === "plain" ? token.text : <span key={index} className={styles[`token-${token.kind}`]}>{token.text}</span>
            ))}</code></pre>
        </figure>
    );
}
