import { normalizeRecipientToSenderMap } from './reloadly.types';

describe('normalizeRecipientToSenderMap', () => {
  it('accepts the plain-object shape', () => {
    const map = normalizeRecipientToSenderMap({
      '25.00': 10264.5,
      '50.00': 20529,
    });

    expect(map.get('25.0000')).toBe(10264.5);
    expect(map.get('50.0000')).toBe(20529);
  });

  it('accepts the documented array-of-objects shape', () => {
    const map = normalizeRecipientToSenderMap([
      { '25.00': 10264.5 },
      { '50.00': 20529 },
    ]);

    expect(map.get('25.0000')).toBe(10264.5);
    expect(map.get('50.0000')).toBe(20529);
  });

  it('returns an empty map for nullish input', () => {
    expect(normalizeRecipientToSenderMap(undefined).size).toBe(0);
    expect(normalizeRecipientToSenderMap(null).size).toBe(0);
  });
});
