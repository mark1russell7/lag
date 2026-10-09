import { useMemo } from "react";
import { useTheme } from "./ThemeProvider";

/**
 * The resolved theme colors, for libraries that need color values instead of
 * CSS custom properties (Observable Plot, Mermaid, React Flow).
 */
export type ThemeColors = {
    /** The categorical series colors, in fixed order. */
    series : readonly string[];
    page : string;
    surface : string;
    surfaceSunken : string;
    ink : string;
    inkSecondary : string;
    inkMuted : string;
    rule : string;
    ruleStrong : string;
    grid : string;
    accent : string;
    accentWash : string;
    mark : string;
    chartGrid : string;
    chartAxis : string;
    status : {
        good : string;
        goodInk : string;
        warning : string;
        warningInk : string;
        critical : string;
        criticalInk : string;
        neutral : string;
    };
};

const LIGHT : ThemeColors = {
    series : ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
    page : "#f5f6f9",
    surface : "#ffffff",
    surfaceSunken : "#eef1f6",
    ink : "#151c2e",
    inkSecondary : "#454f67",
    inkMuted : "#5f6880",
    rule : "#d6dbe5",
    ruleStrong : "#aeb6c7",
    grid : "#e7eaf1",
    accent : "#2346c4",
    accentWash : "#e7ecfd",
    mark : "#c2301f",
    chartGrid : "#e6e9f0",
    chartAxis : "#9aa1b3",
    status : {
        good : "#0ca30c",
        goodInk : "#006300",
        warning : "#fab219",
        warningInk : "#7a5200",
        critical : "#d03b3b",
        criticalInk : "#a3262a",
        neutral : "#8a91a3",
    },
};

/** This function reads the color tokens (refer to styles/tokens.css) from the document. */
export function readThemeColors(root? : Element) : ThemeColors {
    const element = root ?? (typeof document === "undefined" ? undefined : document.documentElement);
    if (!element || typeof getComputedStyle === "undefined") return LIGHT;
    const style = getComputedStyle(element);
    const read = (name : string, fallback : string) : string => style.getPropertyValue(name).trim() || fallback;
    return {
        series : LIGHT.series.map((fallback, index) => read(`--series-${index + 1}`, fallback)),
        page : read("--color-page", LIGHT.page),
        surface : read("--color-surface", LIGHT.surface),
        surfaceSunken : read("--color-surface-sunken", LIGHT.surfaceSunken),
        ink : read("--color-ink", LIGHT.ink),
        inkSecondary : read("--color-ink-secondary", LIGHT.inkSecondary),
        inkMuted : read("--color-ink-muted", LIGHT.inkMuted),
        rule : read("--color-rule", LIGHT.rule),
        ruleStrong : read("--color-rule-strong", LIGHT.ruleStrong),
        grid : read("--color-grid", LIGHT.grid),
        accent : read("--color-accent", LIGHT.accent),
        accentWash : read("--color-accent-wash", LIGHT.accentWash),
        mark : read("--color-mark", LIGHT.mark),
        chartGrid : read("--chart-grid", LIGHT.chartGrid),
        chartAxis : read("--chart-axis", LIGHT.chartAxis),
        status : {
            good : read("--status-good", LIGHT.status.good),
            goodInk : read("--status-good-ink", LIGHT.status.goodInk),
            warning : read("--status-warning", LIGHT.status.warning),
            warningInk : read("--status-warning-ink", LIGHT.status.warningInk),
            critical : read("--status-critical", LIGHT.status.critical),
            criticalInk : read("--status-critical-ink", LIGHT.status.criticalInk),
            neutral : read("--status-neutral", LIGHT.status.neutral),
        },
    };
}

/** The categorical color in slot `index` (0 is slot 1). The slots do not cycle: a chart puts extra series into "Other". */
export function seriesColor(colors : ThemeColors, index : number) : string {
    return colors.series[Math.min(index, colors.series.length - 1)] ?? colors.accent;
}

function parseHex(color : string) : [number, number, number] | undefined {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!match) return undefined;
    const hex = match[1]!.length === 3 ? [...match[1]!].map(digit => digit + digit).join("") : match[1]!;
    return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

/**
 * The color of `color` with the opacity `alpha` on the background
 * `background`, as an opaque hex color. A legend swatch of a light fill uses
 * it. A color that is not a hex color comes back without a change.
 */
export function mixColor(color : string, background : string, alpha : number) : string {
    const front = parseHex(color);
    const back = parseHex(background);
    if (!front || !back) return color;
    const weight = Math.min(1, Math.max(0, alpha));
    return `#${front.map((value, index) => Math.round(value * weight + back[index]! * (1 - weight)).toString(16).padStart(2, "0")).join("")}`;
}

function channel(value : number) : number {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a hex color (WCAG 2), or undefined for a color that is not a hex color. */
export function relativeLuminance(color : string) : number | undefined {
    const rgb = parseHex(color);
    if (!rgb) return undefined;
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** The contrast ratio of two hex colors (WCAG 2), from 1 to 21. */
export function contrastRatio(a : string, b : string) : number {
    const first = relativeLuminance(a) ?? 0;
    const second = relativeLuminance(b) ?? 0;
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The candidate with the highest contrast on `background`, for text on a colored fill. */
export function readableOn(background : string, candidates : readonly string[]) : string {
    return candidates.reduce((best, candidate) => (contrastRatio(candidate, background) > contrastRatio(best, background) ? candidate : best), candidates[0] ?? "#000000");
}

/** The theme colors. The value changes when the theme changes. */
export function useThemeColors() : ThemeColors {
    const { resolved } = useTheme();
    return useMemo(() => readThemeColors(), [resolved]);
}
