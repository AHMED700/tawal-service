import schools from '../../../lib/schools.json';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ticketSchema } from '../../../lib/schema';
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 20000)
      return NextResponse.json({ error: 'الطلب كبير جداً' }, { status: 413 });
    const parsed = ticketSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return NextResponse.json(
        { error: 'تحقق من البيانات المطلوبة' },
        { status: 400 },
      );
    const data = parsed.data;
    if (
      !schools.some(
        (s) =>
          s.code === data.schoolCode &&
          s.city === data.city &&
          s.name === data.schoolName,
      )
    )
      return NextResponse.json(
        { error: 'اختر مدرسة صحيحة من القائمة' },
        { status: 400 },
      );
    const secret = process.env.TURNSTILE_SECRET_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret || !url || !key)
      return NextResponse.json(
        { error: 'النظام غير مهيأ لاستقبال البلاغات' },
        { status: 503 },
      );
    const verify = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ secret, response: data.captchaToken }),
      },
    );
    const result = await verify.json();
    const expectedHost = process.env.TURNSTILE_EXPECTED_HOSTNAME;
    if (!expectedHost)
      return NextResponse.json(
        { error: 'إعداد الحماية غير مكتمل' },
        { status: 503 },
      );
    if (
      !verify.ok ||
      !result.success ||
      result.hostname !== expectedHost ||
      result.action !== 'school_ticket'
    )
      return NextResponse.json({ error: 'فشل التحقق الأمني' }, { status: 403 });
    const db = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: ticket, error } = await db.rpc('create_school_ticket', {
      payload: {
        school_name: data.schoolName,
        school_code: data.schoolCode,
        city: data.city,
        contact_name: data.contactName,
        contact_phone: data.phone,
        contact_email: data.email,
        school_notes: data.notes,
        units: data.units.map((u) => ({
          ac_number: u.acNumber,
          problem_type: u.problemType,
          ac_location: u.location,
          school_notes: u.notes,
        })),
      },
    });
    if (error) throw error;
    return NextResponse.json({ ticketNumber: ticket }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError)
      return NextResponse.json(
        { error: 'صيغة الطلب غير صالحة' },
        { status: 400 },
      );
    console.error('Ticket submission failed');
    return NextResponse.json(
      { error: 'تعذر حفظ البلاغ، يرجى المحاولة لاحقاً' },
      { status: 500 },
    );
  }
}
