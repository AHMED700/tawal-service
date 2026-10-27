import { NextResponse } from 'next/server';
import { staffFromRequest, failure } from '../../../../lib/staff';
export async function GET(req: Request) {
  try {
    const staff = await staffFromRequest(req);
    if (!staff) return failure('غير مصرح', 401);
    let q = staff.db
      .from('tickets')
      .select('*,ticket_units(*)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (staff.role === 'leader') q = q.eq('assigned_leader_id', staff.user_id);
    const { data, error } = await q;
    if (error) throw error;
    const ids = (data || []).map((t) => t.id);
    const { data: sessions, error: sessionError } = ids.length
      ? await staff.db
          .from('ticket_work_sessions')
          .select('id,ticket_id,leader_id,started_at,ended_at,duration_seconds')
          .in('ticket_id', ids)
          .order('started_at', { ascending: false })
      : { data: [], error: null };
    if (sessionError) throw sessionError;
    const { data: events, error: eventError } = ids.length
      ? await staff.db
          .from('ticket_events')
          .select('ticket_id,details')
          .in('ticket_id', ids)
          .eq('event_type', 'returned_for_revision')
          .order('occurred_at', { ascending: false })
      : { data: [], error: null };
    if (eventError) throw eventError;
    const leaders =
      staff.role === 'admin'
        ? (
            await staff.db
              .from('staff_profiles')
              .select('user_id,display_name')
              .eq('role', 'leader')
              .eq('active', true)
          ).data
        : [];
    return NextResponse.json({
      role: staff.role,
      name: staff.display_name,
      tickets: data,
      sessions: sessions || [],
      events: events || [],
      leaders,
    });
  } catch (e) {
    console.error('Staff tickets load failed');
    return failure('تعذر تحميل البلاغات', 500);
  }
}
