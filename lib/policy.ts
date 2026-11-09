export const ZONE='Asia/Baghdad';
const DAY_HOURS:Record<number,string>={0:'17:00–20:00',1:'17:00–20:00',2:'17:00–20:00',3:'17:00–20:00',6:'12:00–17:00'};
export function clinicHours(isoDate:string): string|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date=new Date(`${isoDate}T12:00:00Z`);
  if(Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==isoDate) return null;
  return DAY_HOURS[date.getUTCDay()] ?? null;
}
export function isPastClinicDate(isoDate:string, now =new Date()):boolean {
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return isoDate<today;
}
export function normalizePhone(raw:string|undefined):string|null {
  if(!raw?.trim())return null;
  const value=raw.trim().replace(/[\s()-]/g,'');
  return /^\+[1-9]\d{7,14}$/.test(value)?value:null;
}
export function requestReply(locale:'ar'|'en', code:string, date:string, hours:string):string {
  if(locale==='ar') return `تم تسجيل طلب المراجعة رقم ${code} ليوم ${date}، الدوام ${hours}. يرجى الرد بكلمة «تأكيد» أو «إلغاء». التسجيل ليس حجزاً لوقت محدد، والدخول حسب أسبقية الوصول.`;
  return `Registration request ${code} for ${date} (${hours}) was saved. Reply CONFIRM or CANCEL. This does not reserve a consultation time; entry is by order of arrival.`;
}
export function confirmationReply(locale:'ar'|'en', code:string):string {
  return locale==='ar'?`تم تأكيد تسجيل المراجعة رقم ${code}. الدخول حسب أسبقية الوصول عند حضوركم للعيادة.`:`Registration ${code} confirmed. Patients are seen in their actual order of arrival.`;
}
export function replyIntent(body:string): 'CONFIRM'|'CANCEL'|'HUMAN'|'EMERGENCY'|'UNKNOWN' {
 const s=body.trim().toLowerCase();
 if(/(شلل|فقدان السيطرة على البول|احتباس البول|ضعف شديد مفاجئ|paralysis|loss of bladder|bowel control|new severe weakness)/i.test(s))return 'EMERGENCY';
 if(/^(تأكيد|اؤكد|أؤكد|نعم|confirm|yes|1)$/i.test(s))return 'CONFIRM';
 if(/^(إلغاء|الغاء|cancel|no|2)$/i.test(s))return 'CANCEL';
 if(/(موظف|سكرتارية|human|secretary|reception)/i.test(s))return 'HUMAN';
 return 'UNKNOWN';
}
