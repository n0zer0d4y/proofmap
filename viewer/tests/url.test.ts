import { describe, expect, it } from 'vitest';
import { emptyUrlState, isNavigation, parse, serialize } from '../src/state/url';

describe('URL hash state', () => {
  it('round-trips a full state', () => {
    const s = {
      ...emptyUrlState(),
      view: 'outline' as const,
      focus: 'Fixture.main_result',
      anchor: 'Fixture.tainted_result',
      expanded: ['ClashDemo.value~Fixture.Clash.A', "Fixture.double_eq_add'"],
      groups: ['grp:12:Facts', 'ext:Init.Prelude'],
      preset: 'auditor' as const,
      theme: 'dark' as const,
      showNoise: true,
      pathFrom: 'Fixture.double',
      pathTo: 'Fixture.main_result',
      walkthrough: true,
    };
    expect(parse(serialize(s), 'map')).toEqual(s);
  });

  it('keeps names readable', () => {
    expect(serialize({ ...emptyUrlState(), focus: 'Nat.sum_four_squares' })).toBe(
      '#/map/Nat.sum_four_squares',
    );
  });

  it('round-trips names with unusual characters', () => {
    const s = { ...emptyUrlState(), focus: 'Foo.«weird name»?&=/' };
    expect(parse(serialize(s), 'map').focus).toBe('Foo.«weird name»?&=/');
  });

  it('falls back to the preset view and ignores junk', () => {
    expect(parse('', 'outline').view).toBe('outline');
    expect(parse('#/nonsense?preset=boss&theme=pink', 'health')).toEqual(emptyUrlState('health'));
  });

  it('treats view and focus changes as navigation', () => {
    const a = emptyUrlState();
    expect(isNavigation(a, { ...a, focus: 'X' })).toBe(true);
    expect(isNavigation(a, { ...a, view: 'outline' })).toBe(true);
    expect(isNavigation(a, { ...a, expanded: ['X'] })).toBe(false);
  });
});
