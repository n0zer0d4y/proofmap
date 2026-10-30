import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast } from '../src/theme/contrast';
import { CODE_BG } from '../src/components/CodeBlock';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#6a737d', '#f1f1ef')).toBeCloseTo(4.25, 1);
  });
  it('raises failing token colours to the target and leaves good ones alone', () => {
    for (const [c, bg] of [
      ['#6a737d', CODE_BG.light],
      ['#d73a49', CODE_BG.light],
      ['#6a737d', CODE_BG.dark],
    ] as const) {
      expect(contrast(ensureContrast(c, bg), bg)).toBeGreaterThanOrEqual(5);
    }
    expect(ensureContrast('#24292e', CODE_BG.light)).toBe('#24292e');
  });
});
