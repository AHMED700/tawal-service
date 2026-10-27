import { z } from 'zod';
import { ISSUE_TYPES } from './issues';
export const unitSchema = z.object({
  acNumber: z
    .string()
    .regex(/^[0-9]{1,3}$/, 'رقم المكيف يجب أن يتكون من 1 إلى 3 أرقام إنجليزية'),
  problemType: z.enum(ISSUE_TYPES),
  location: z.string().trim().min(1).max(120),
  notes: z.string().max(500).optional().default(''),
});
export const ticketSchema = z.object({
  schoolName: z.string().trim().min(2).max(160),
  schoolCode: z.string().max(40).optional().default(''),
  city: z.string().trim().min(2).max(100),
  contactName: z.string().max(120).optional().default(''),
  phone: z.string().trim().min(6).max(25),
  email: z
    .union([z.literal(''), z.string().email()])
    .optional()
    .default(''),
  notes: z.string().max(1000).optional().default(''),
  units: z
    .array(unitSchema)
    .min(1)
    .max(10)
    .superRefine((units, ctx) => {
      const seen = new Set<number>();
      units.forEach((unit, index) => {
        if (!/^[0-9]{1,3}$/.test(unit.acNumber)) return;
        const number = Number(unit.acNumber);
        if (seen.has(number))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'acNumber'],
            message: 'رقم المكيف مكرر في الطلب',
          });
        seen.add(number);
      });
    }),
  captchaToken: z.string().min(1),
});
