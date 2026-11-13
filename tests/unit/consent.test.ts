import { describe, it, expect } from 'vitest';
import { isConsentAcknowledgment, isDeletionRequest } from '../../lib/consent';

describe('isConsentAcknowledgment', () => {
  it.each([
    ['نعم', true],
    ['أوافق على الشروط', true],
    ['موافق', true],
    ['اوافق', true],
    ['موافقة', true],
    ['yes', true],
    ['YES', true],
    ['i agree to terms', true],
    ['agree', true],
    ['ok', true],
    ['OK', true],
    ['okay', true],
    ['OKAY', true],
  ])('"%s" → %s', (msg, expected) => {
    expect(isConsentAcknowledgment(msg)).toBe(expected);
  });

  it.each([
    ['أريد حجز موعد'],
    ['كيف أحجز؟'],
    ['what are your hours'],
    ['book appointment'],
    ['cancel my booking'],
    ['لا'],
    ['no'],
    ['نعم بس'],  // "نعم" with extra text — not an exact match
  ])('"%s" → false', (msg) => {
    expect(isConsentAcknowledgment(msg)).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(isConsentAcknowledgment('  نعم  ')).toBe(true);
    expect(isConsentAcknowledgment('  yes  ')).toBe(true);
  });
});

describe('isDeletionRequest', () => {
  it.each([
    ['احذف بياناتي', true],
    ['حذف بياناتي من فضلك', true],
    ['delete my data', true],
    ['please delete my data now', true],
    ['erase my data', true],
    ['remove my data', true],
    ['forget me', true],
    ['please forget me', true],
  ])('"%s" → %s', (msg, expected) => {
    expect(isDeletionRequest(msg)).toBe(expected);
  });

  it.each([
    ['أريد حجز موعد'],
    ['what time do you open'],
    ['cancel my appointment'],
    ['نعم'],
    ['delete'],      // partial — no "my data"
    ['احذف'],        // partial
  ])('"%s" → false', (msg) => {
    expect(isDeletionRequest(msg)).toBe(false);
  });
});
