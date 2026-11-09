import { z } from 'zod';
export const bookingInput=z.object({
 displayName:z.string().trim().min(2).max(100),
 phone:z.string().trim().max(32).optional(),
 sourceChannel:z.enum(['SIMULATED_WHATSAPP','WA_01','WA_02','WA_03','INSTAGRAM','FACEBOOK','TIKTOK','WIX']),
 externalContactRef:z.string().trim().min(1).max(120),
 clinicDate:z.iso.date(),
 locale:z.enum(['ar','en']).default('ar')
});
export const messageInput=z.object({ contactRef:z.string().min(1).max(120), name:z.string().min(2).max(100), phone:z.string().optional(), body:z.string().min(1).max(500), clinicDate:z.iso.date().optional(), locale:z.enum(['ar','en']).default('ar') });
