import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PARTS } from '../../../../../lib/parts';
import { staffFromRequest, failure } from '../../../../../lib/staff';
const idSchema = z.string().uuid();
const change = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), leaderId: z.string().uuid() }),
  z.object({
    action: z.literal('unit'),
    unitId: z.string().uuid(),
    status: z.enum([
      'pending',
      'in_progress',
      'pending_follow_up',
      'completed',
      'replaced',
    ]),
    maintenanceResult: z.string().max(2000).default(''),
    replacedParts: z.string().max(1000).default(''),
    followUpReason: z
      .enum(['parts', 'workshop', 'approval', 'return_visit', 'other'])
      .nullable()
      .optional(),
    parts: z
      .array(
        z.object({
          code: z.enum(
            PARTS.map((p) => p.id) as [
              (typeof PARTS)[number]['id'],
              ...(typeof PARTS)[number]['id'][],
            ],
          ),
          name: z.string().max(120).optional(),
          quantity: z.number().int().min(1).max(999),
          usage: z.enum(['used', 'required']),
        }),
      )
      .max(20)
      .default([]),
  }),
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('finish') }),
  z.object({ action: z.literal('close') }),
  z.object({
    action: z.literal('return_for_revision'),
    reason: z.string().trim().min(5).max(1000),
  }),
]);
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) return failure('معرف غير صالح', 400);
    const staff = await staffFromRequest(req);
    if (!staff) return failure('غير مصرح', 401);
    const raw = await req.text();
    if (raw.length > 10000) return failure('الطلب كبير', 413);
    const parsed = change.safeParse(JSON.parse(raw));
    if (!parsed.success) return failure('بيانات غير صالحة', 400);
    const { data: ticket } = await staff.db
      .from('tickets')
      .select('id,status,assigned_leader_id')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return failure('البلاغ غير موجود', 404);
    const d = parsed.data;
    // Database RPC performs authorization and mutation atomically to avoid races.
    const { data, error } = await staff.adminDb.rpc('staff_ticket_action', {
      p_actor: staff.user_id,
      p_ticket: id,
      p_action: d.action,
      p_payload:
        d.action === 'return_for_revision'
          ? { reason: d.reason }
          : d.action === 'assign'
            ? { leader_id: d.leaderId }
            : d.action === 'unit'
              ? {
                  unit_id: d.unitId,
                  status: d.status,
                  maintenance_result: d.maintenanceResult,
                  replaced_parts: d.replacedParts,
                  follow_up_reason: d.followUpReason,
                  parts: d.parts,
                }
              : {},
    });
    if (error) {
      console.error('Staff ticket action rejected');
      return failure('لم تنفذ العملية؛ تحقق من حالة البلاغ وصلاحياتك', 409);
    }
    return NextResponse.json({ ok: true, result: data });
  } catch (e) {
    if (e instanceof SyntaxError) return failure('صيغة الطلب غير صالحة', 400);
    console.error('Staff action failed');
    return failure('تعذر تنفيذ العملية', 500);
  }
}
