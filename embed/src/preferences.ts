export const themes = [
  "graphite",
  "carbon",
  "emerald",
  "synthwave",
  "linen",
  "windows311",
  "windowsxp",
  "macintosh",
  "macos9",
  "gameboy",
  "commodore64",
] as const;
export type Theme = (typeof themes)[number];
export interface Preferences {
  theme: Theme;
  side: "left" | "right";
  size: "standard" | "large";
  pauseAnimations: boolean;
  hideDots: boolean;
}
export function preferences(value: unknown): Preferences {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const aliases: Record<string, Theme> = {
    slate: "graphite",
    aqua: "macos9",
    nes: "graphite",
    pipboy: "emerald",
    cobalt: "graphite",
    terminal: "graphite",
    blueprint: "graphite",
    midnight: "graphite",
    windows95: "windows311",
    amiga: "windowsxp",
    nextstep: "carbon",
    blurple: "graphite",
    paper: "linen",
    harbor: "graphite",
    spotify: "emerald",
  };
  if (typeof v.theme === "string" && aliases[v.theme])
    v.theme = aliases[v.theme];
  return {
    theme:
      v.theme === "spotify"
        ? "emerald"
        : themes.includes(v.theme as Theme)
          ? (v.theme as Theme)
          : "graphite",
    side: v.side === "right" ? "right" : "left",
    size: v.size === "large" ? "large" : "standard",
    pauseAnimations: v.pauseAnimations === true,
    hideDots: v.hideDots === true,
  };
}
export function panelPlacement(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  panel: { width: number; height: number },
  sidebar?: { side: "left" | "right"; width: number },
) {
  const margin = 12,
    gap = 12,
    width = Math.min(panel.width, Math.max(0, viewport.width - margin * 2));
  let minX = margin,
    maxX = Math.max(margin, viewport.width - width - margin);
  if (sidebar && viewport.width - sidebar.width - margin - gap >= width) {
    if (sidebar.side === "left") minX = sidebar.width + gap;
    else maxX = viewport.width - sidebar.width - gap - width;
  }
  return {
    left: Math.max(minX, Math.min(maxX, point.x + 16)),
    top: Math.max(
      margin,
      Math.min(
        Math.max(margin, viewport.height - panel.height - margin),
        point.y + 16,
      ),
    ),
  };
}

export function pageIdentity(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of Array.from(url.searchParams.keys()))
    if (
      key.toLowerCase().startsWith("utm_") ||
      ["gclid", "fbclid"].includes(key.toLowerCase())
    )
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.origin + url.pathname + url.search;
}
