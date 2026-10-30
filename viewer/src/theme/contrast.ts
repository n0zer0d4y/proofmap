/**
 * Colour contrast (WCAG 2.1). Syntax themes are designed for their own
 * backgrounds; on ours a few token colours (comments, keywords) fall just under 4.5:1. Such a
 * colour is moved towards black (light theme) or white (dark theme) until it reaches the target.
 */

const parse = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrast(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 21;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** `color`, moved away from `background` until their contrast is at least `target`. */
export function ensureContrast(color: string, background: string, target = 5): string {
  const c = parse(color);
  const bg = parse(background);
  if (!c || !bg || contrast(color, background) >= target) return color;
  const towards = luminance(bg) > 0.5 ? 0 : 255;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const mixed = hex(c.map((v) => v + (towards - v) * t));
    if (contrast(mixed, background) >= target) return mixed;
  }
  return towards === 0 ? '#000000' : '#ffffff';
}
