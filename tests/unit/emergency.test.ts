/**
 * Unit tests for the emergency keyword guard (lib/emergency.ts).
 *
 * Verifies Arabic, Iraqi dialect, and English trigger words, and
 * confirms that normal booking messages are not flagged.
 */

import { describe, it, expect } from 'vitest';
import { checkEmergency } from '@/lib/emergency';

describe('checkEmergency()', () => {
  // ---------------------------------------------------------------------------
  // Arabic emergency keywords
  // ---------------------------------------------------------------------------

  it('detects Arabic "طوارئ" (emergency)', () => {
    expect(checkEmergency('أنا بحاجة إلى طوارئ').isEmergency).toBe(true);
  });

  it('detects Arabic "إسعاف" (ambulance)', () => {
    expect(checkEmergency('أريد إسعاف فوراً').isEmergency).toBe(true);
  });

  it('detects Arabic "ألم شديد" (severe pain)', () => {
    expect(checkEmergency('عندي ألم شديد في الركبة').isEmergency).toBe(true);
  });

  it('detects Arabic "ألم حاد" (acute pain)', () => {
    expect(checkEmergency('ألم حاد جداً لا أحتمله').isEmergency).toBe(true);
  });

  it('detects Arabic "كسر" (fracture)', () => {
    expect(checkEmergency('أعتقد عندي كسر في الساق').isEmergency).toBe(true);
  });

  it('detects Arabic "سقطت" (I fell)', () => {
    expect(checkEmergency('سقطت من السلم').isEmergency).toBe(true);
  });

  it('detects Arabic "لا أستطيع الحركة" (cannot move)', () => {
    expect(checkEmergency('لا أستطيع الحركة').isEmergency).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Iraqi dialect variants
  // ---------------------------------------------------------------------------

  it('detects Iraqi dialect "ما أقدر أتحرك"', () => {
    expect(checkEmergency('ما أقدر أتحرك').isEmergency).toBe(true);
  });

  it('detects Iraqi dialect "مو قادر أتحرك"', () => {
    expect(checkEmergency('مو قادر أتحرك من الألم').isEmergency).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // English emergency keywords
  // ---------------------------------------------------------------------------

  it('detects English "emergency"', () => {
    expect(checkEmergency('This is an emergency').isEmergency).toBe(true);
  });

  it('detects English "urgent"', () => {
    expect(checkEmergency('This is urgent, please help').isEmergency).toBe(true);
  });

  it('detects English "severe pain"', () => {
    expect(checkEmergency('I have severe pain').isEmergency).toBe(true);
  });

  it('detects English "fracture"', () => {
    expect(checkEmergency('I think I have a fracture').isEmergency).toBe(true);
  });

  it('detects English "cannot move"', () => {
    expect(checkEmergency('I cannot move my leg').isEmergency).toBe(true);
  });

  it('detects English "can\'t move" (contraction)', () => {
    expect(checkEmergency("I can't move at all").isEmergency).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Normal booking messages — must NOT be flagged
  // ---------------------------------------------------------------------------

  it('does not flag a booking request in Arabic', () => {
    expect(checkEmergency('أريد حجز موعد يوم الأحد').isEmergency).toBe(false);
  });

  it('does not flag a booking request in English', () => {
    expect(checkEmergency('I would like to book an appointment').isEmergency).toBe(false);
  });

  it('does not flag a cancellation request', () => {
    expect(checkEmergency('أريد إلغاء موعدي').isEmergency).toBe(false);
  });

  it('does not flag a clinic hours question', () => {
    expect(checkEmergency('ما هي مواعيد العيادة؟').isEmergency).toBe(false);
  });

  it('does not flag an empty string', () => {
    expect(checkEmergency('').isEmergency).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Reply content
  // ---------------------------------------------------------------------------

  it('fixedReply contains Arabic text', () => {
    const result = checkEmergency('طوارئ');
    expect(result.fixedReply).toMatch(/طوارئ|إسعاف|موظفي/);
  });

  it('fixedReply contains English text', () => {
    const result = checkEmergency('emergency');
    expect(result.fixedReply).toMatch(/emergency|ambulance|staff/i);
  });
});
