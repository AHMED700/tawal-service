'use client';
import { PARTS, PartItem } from '../../../lib/parts';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { browserDb } from '../../../lib/browser-db';
import Link from 'next/link';
type Unit = {
  id: string;
  item_number: number;
  ac_number: string;
  problem_type: string;
  ac_location: string;
  status: string;
  maintenance_result: string | null;
  replaced_parts: string | null;
  parts?: PartItem[];
};
type Ticket = {
  id: string;
  ticket_number: number;
  school_name: string;
  city: string;
  contact_name: string | null;
  contact_phone: string;
  created_at: string;
  status: string;
  ticket_units: Unit[];
  assigned_leader_id: string | null;
};
type Visit = {
  id: string;
  ticket_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
};
const states: Record<string, string> = {
  submitted: 'جديد',
  assigned: 'مسند',
  in_progress: 'قيد التنفيذ',
  pending_follow_up: 'يحتاج متابعة',
  completed: 'مكتمل',
  closed: 'مغلق',
  revision_required: 'معاد للاستكمال',
  pending: 'لم يبدأ',
  replaced: 'تم الاستبدال',
};
export default function Report() {
  const { id } = useParams<{ id: string }>(),
    [ticket, setTicket] = useState<Ticket | null>(null),
    [visits, setVisits] = useState<Visit[]>([]),
    [leaderName, setLeaderName] = useState(''),
    [error, setError] = useState(''),
    [internal, setInternal] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
          key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) throw Error('قاعدة البيانات غير مهيأة');
        const db = browserDb();
        const {
          data: { session },
        } = await db.auth.getSession();
        if (!session) {
          location.href = '/login';
          return;
        }
        const r = await fetch('/api/staff/tickets', {
          headers: { Authorization: 'Bearer ' + session.access_token },
          cache: 'no-store',
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.error || 'تعذر التحميل');
        const found = (data.tickets as Ticket[]).find((t) => t.id === id);
        if (!found) throw Error('البلاغ غير متاح لحسابك');
        if (alive) {
          setTicket(found);
          setVisits(
            (data.sessions || []).filter((v: Visit) => v.ticket_id === id),
          );
          setLeaderName(
            data.role === 'leader'
              ? data.name
              : (data.leaders || []).find(
                  (l: { user_id: string }) =>
                    l.user_id === found.assigned_leader_id,
                )?.display_name || '—',
          );
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : 'تعذر عرض التقرير');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);
  const units = [...(ticket?.ticket_units || [])].sort(
      (a, b) => a.item_number - b.item_number,
    ),
    finished = units.filter((u) =>
      ['completed', 'replaced'].includes(u.status),
    ).length;
  return (
    <main className="report-page">
      <div className="report-toolbar no-print">
        <Link href="/dashboard">العودة إلى لوحة الصيانة</Link>
        <label>
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
          />{' '}
          إظهار بيانات التواصل (نسخة داخلية)
        </label>
        <button onClick={() => window.print()} disabled={!ticket}>
          طباعة / حفظ PDF
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!ticket && !error && <p>جارٍ تحميل التقرير...</p>}
      {ticket && (
        <article className="report-paper" dir="rtl">
          <header className="report-head">
            <div>
              <h1>توال العالمية</h1>
              <p>TAWAL INTERNATIONAL</p>
              <strong>تقرير صيانة أجهزة التكييف</strong>
              <div>Air Conditioning Maintenance Report</div>
            </div>
            <div className="report-number">
              #{ticket.ticket_number}
              <small>رقم البلاغ / Ticket No.</small>
            </div>
          </header>
          <div className="report-meta">
            <div>
              <b>المدرسة / School</b>
              <span>{ticket.school_name}</span>
            </div>
            <div>
              <b>الولاية / City</b>
              <span>{ticket.city}</span>
            </div>
            <div>
              <b>التاريخ / Date</b>
              <span>
                {new Date(ticket.created_at).toLocaleDateString('en-GB')}
              </span>
            </div>
            <div>
              <b>الحالة / Status</b>
              <span>{states[ticket.status] || ticket.status}</span>
            </div>
            <div>
              <b>عدد المكيفات / Units</b>
              <span>{units.length}</span>
            </div>
          </div>
          {internal && (
            <p>
              <b>التواصل / Contact:</b> {ticket.contact_name || '—'} —{' '}
              {ticket.contact_phone}
            </p>
          )}
          <section className="visit-summary">
            <h2>الزيارات / Visits</h2>
            <p>قائد الفريق / Team Leader: {leaderName || '—'}</p>
            <p>
              إجمالي الزيارات المنتهية / Total:{' '}
              {Math.floor(
                visits.reduce((n, v) => n + (v.duration_seconds || 0), 0) / 60,
              )}{' '}
              دقيقة / min
            </p>
            {visits.map((v) => (
              <p key={v.id}>
                {new Date(v.started_at).toLocaleString('ar-OM', {
                  timeZone: 'Asia/Muscat',
                })}{' '}
                —{' '}
                {v.ended_at
                  ? `${Math.floor((v.duration_seconds || 0) / 60)} دقيقة / min`
                  : 'جارية / In progress'}
              </p>
            ))}
          </section>
          <h2>تفاصيل أعمال الصيانة / Maintenance Details</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>
                  رقم المكيف
                  <br />
                  AC No.
                </th>
                <th>
                  العطل
                  <br />
                  Issue
                </th>
                <th>
                  الموقع
                  <br />
                  Location
                </th>
                <th>
                  الحالة
                  <br />
                  Status
                </th>
                <th>
                  نتيجة الصيانة
                  <br />
                  Result
                </th>
                <th>
                  القطع المستبدلة
                  <br />
                  Parts
                </th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td>{u.item_number}</td>
                  <td>{u.ac_number}</td>
                  <td>{u.problem_type}</td>
                  <td>{u.ac_location}</td>
                  <td>{states[u.status] || u.status}</td>
                  <td>{u.maintenance_result || '—'}</td>
                  <td>
                    {u.parts?.length
                      ? u.parts.map((p, i) => (
                          <div key={i}>
                            {PARTS.find((x) => x.id === p.code)?.ar || p.code}
                            {p.name ? ' (' + p.name + ')' : ''} ×{p.quantity} —{' '}
                            {p.usage === 'used' ? 'مستخدم' : 'مطلوب'}
                          </div>
                        ))
                      : u.replaced_parts || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="report-summary">
            <span>
              الإجمالي / Total: <b>{units.length}</b>
            </span>
            <span>
              المكتمل / Finished: <b>{finished}</b>
            </span>
            <span>
              المتبقي / Remaining: <b>{units.length - finished}</b>
            </span>
          </div>
          <div className="report-sign">
            <div>
              قائد الفريق / Team Leader
              <br />
              ________________________
            </div>
            <div>
              اعتماد الإدارة / Management Approval
              <br />
              ________________________
            </div>
          </div>
          <footer className="report-footer">
            TAWAL INTERNATIONAL · Generated from TAWAL Service
          </footer>
        </article>
      )}
    </main>
  );
}
