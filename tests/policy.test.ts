import {describe,it,expect} from 'vitest';import {clinicHours,normalizePhone,replyIntent,requestReply} from '../lib/policy';
describe('clinic rules',()=>{
 it('Saturday afternoon',()=>expect(clinicHours('2026-11-07')).toBe('12:00–17:00'));
 it('Sunday to Wednesday evening',()=>{for(const date of ['2026-11-08','2026-11-09','2026-11-10','2026-11-11'])expect(clinicHours(date)).toBe('17:00–20:00')});
 it('closed Thursday and Friday',()=>{expect(clinicHours('2026-11-12')).toBeNull();expect(clinicHours('2026-11-13')).toBeNull()});
 it('rejects invalid dates',()=>{expect(clinicHours('2026-02-30')).toBeNull();expect(clinicHours('bad')).toBeNull()});
 it('requires normalized E.164 telephone',()=>{expect(normalizePhone('+964 771 123 4567')).toBe('+9647711234567');expect(normalizePhone('0771')).toBeNull()});
 it('recognizes explicit confirmation and cancellation',()=>{expect(replyIntent('تأكيد')).toBe('CONFIRM');expect(replyIntent('cancel')).toBe('CANCEL');expect(replyIntent('seen')).toBe('UNKNOWN')});
 it('recognizes emergency before anything else',()=>expect(replyIntent('new paralysis')).toBe('EMERGENCY'));
 it('does not promise an appointment time',()=>expect(requestReply('en','GH-DEMO','2026-11-09','17:00–20:00')).toContain('does not reserve a consultation time'));
});
