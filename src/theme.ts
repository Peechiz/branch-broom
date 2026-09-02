/** Colors via Bun.Color, so the palette lives as hex in one place. */

const RESET = "\x1b[0m";
const useColor = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const palette = {
  merged: "#22c55e",
  warn: "#eab308",
  danger: "#ef4444",
  accent: "#22d3ee",
  muted: "#8b8b93",
  heading: "#e4e4e7",
} as const;

type Tone = keyof typeof palette;

const codes = new Map<Tone, string>();
for (const [tone, hex] of Object.entries(palette)) {
  codes.set(tone as Tone, Bun.color(hex, "ansi") ?? "");
}

const paint =
  (tone: Tone) =>
  (s: string): string =>
    useColor() ? `${codes.get(tone) ?? ""}${s}${RESET}` : s;

export const c = {
  green: paint("merged"),
  yellow: paint("warn"),
  red: paint("danger"),
  cyan: paint("accent"),
  dim: paint("muted"),
  bold: (s: string) => (useColor() ? `\x1b[1m${s}${RESET}` : s),
  title: (s: string) => (useColor() ? `\x1b[1m${codes.get("heading")}${s}${RESET}` : s),
};

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
