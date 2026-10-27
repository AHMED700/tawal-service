'use client';
import { PARTS, PartItem } from '../../lib/parts';
import { useEffect, useState, useCallback } from 'react';
import { browserDb, accessToken } from '../../lib/browser-db';
import Link from 'next/link';
type Unit = {
  id: string;
  item_number: number;
  ac_number: string;
  problem_type: string;
  ac_location: string;
  school_notes: string | null;
  status: string;
  maintenance_result: string | null;
  replaced_parts: string | null;
  follow_up_reason?: string | null;
  parts?: PartItem[];
};
type Ticket = {
  id: string;
  ticket_number: number;
  school_name: string;
  city: string;
  contact_name: string | null;
  contact_phone: string;
  status: string;
  assigned_leader_id: string | null;
  created_at: string;
  ticket_units: Unit[];
};
type WorkSession = {
  id: string;
  ticket_id: string;
  leader_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
};
type Leader = { user_id: string; display_name: string };
const statuses: Record<string, string> = {
  submitted: 'جديد',
  assigned: 'مسند',
  in_progress: 'قيد الصيانة',
  pending_follow_up: 'بانتظار متابعة',
  completed: 'مكتمل',
  revision_required: 'مُعاد لاستكمال البيانات',
  closed: 'مغلق إدارياً',
};
const unitStatuses: Record<string, string> = {
  pending: 'لم يبدأ',
  in_progress: 'قيد العمل',
  pending_follow_up: 'يحتاج متابعة',
  completed: 'تم الإصلاح',
  replaced: 'تم الاستبدال',
};
export default function Dashboard() {
  const [returnReason, setReturnReason] = useState(''),
    [query, setQuery] = useState(''),
    [statusFilter, setStatusFilter] = useState('open');
  const [dirtyUnits, setDirtyUnits] = useState<Record<string, boolean>>({});
  const markDirty = useCallback(
    (id: string, dirty: boolean) =>
      setDirtyUnits((old) =>
        old[id] === dirty ? old : { ...old, [id]: dirty },
      ),
    [],
  );
  const hasDrafts = Object.values(dirtyUnits).some(Boolean);
  const [leaderFilter, setLeaderFilter] = useState('all');
  const openTicket = (id: string) => {
    if (hasDrafts && !confirm('توجد نتائج غير محفوظة، هل تريد تركها؟')) return;
    setSelected(id);
    setReturnReason('');
  };
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [events, setEvents] = useState<
    { ticket_id: string; details: { reason?: string } }[]
  >([]);
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [sessions, setSessions] = useState<WorkSession[]>([]),
    [leaders, setLeaders] = useState<Leader[]>([]),
    [role, setRole] = useState(''),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async (t: string) => {
    const r = await fetch('/api/staff/tickets', {
      headers: { Authorization: 'Bearer ' + t },
      cache: 'no-store',
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setTickets(d.tickets || []);
    setEvents(d.events || []);
    setLoading(false);
    setSessions(d.sessions || []);
    setLeaders(d.leaders || []);
    setRole(d.role);
    setName(d.name);
  }, []);
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    try {
      const db = browserDb();
      const {
        data: { subscription },
      } = db.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          location.href = '/login';
          return;
        }
      });
      unsubscribe = () => subscription.unsubscribe();
      accessToken()
        .then((t) => load(t))
        .catch((e) => {
          if (alive) setError(e instanceof Error ? e.message : 'تعذر التحميل');
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التحميل');
    }
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [load]);
  async function logout() {
    try {
      const { error } = await browserDb().auth.signOut();
      if (error) throw error;
      location.href = '/login';
    } catch {
      setError('تعذر تسجيل الخروج، حاول مجدداً');
    }
  }
  async function action(id: string, body: object) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const currentToken = await accessToken();
      const r = await fetch('/api/staff/tickets/' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + currentToken,
        },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load(currentToken);
      setNotice('تم حفظ التحديث بنجاح');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const chosen = tickets.find((t) => t.id === selected);
  const visible = tickets.filter(
    (t) =>
      (statusFilter === 'all' ||
        (statusFilter === 'open'
          ? t.status !== 'closed'
          : t.status === statusFilter)) &&
      (leaderFilter === 'all' ||
        (leaderFilter === 'unassigned'
          ? !t.assigned_leader_id
          : t.assigned_leader_id === leaderFilter)) &&
      [t.ticket_number, t.school_name, t.city]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const visits = sessions.filter((s) => s.ticket_id === selected);
  const active = visits.find((s) => !s.ended_at);
  const missingOutcomes = chosen?.ticket_units.some(
    (u) =>
      ['pending', 'in_progress'].includes(u.status) ||
      (u.status === 'pending_follow_up' && !u.follow_up_reason),
  );
  const seconds = visits.reduce((n, s) => n + (s.duration_seconds || 0), 0);
  const fmt = (n: number) =>
    `${Math.floor(n / 3600)} ساعة و${Math.floor((n % 3600) / 60)} دقيقة`;

  return (
    <main>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>لوحة الصيانة</h1>
          <p>
            {name} — {role === 'admin' ? 'مدير النظام' : 'قائد فريق'}
          </p>
        </div>
        <div className="actions">
          <Link href="/">نموذج المدرسة</Link>
          <button className="secondary" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      </div>
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="card">
        <h2>البلاغات ({tickets.length})</h2>
        <div className="summary-grid">
          {[
            ['submitted', 'جديد'],
            ['assigned', 'مسند'],
            ['in_progress', 'قيد التنفيذ'],
            ['pending_follow_up', 'متابعة'],
            ['completed', 'بانتظار اعتماد'],
            ['revision_required', 'استكمال'],
            ['closed', 'مغلق'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={statusFilter === key ? '' : 'secondary'}
              aria-pressed={statusFilter === key}
              onClick={() => setStatusFilter(key)}
            >
              {label} ({tickets.filter((t) => t.status === key).length})
            </button>
          ))}
        </div>
        <button
          className="secondary"
          disabled={busy || hasDrafts}
          onClick={async () => {
            setBusy(true);
            try {
              await load(await accessToken());
              setError('');
            } catch {
              setError('تعذر تحديث البلاغات');
            } finally {
              setBusy(false);
            }
          }}
        >
          تحديث البلاغات
        </button>
        {loading && !error && <p role="status">جارٍ تحميل البلاغات...</p>}
        <div className="actions">
          <input
            aria-label="بحث البلاغات"
            placeholder="بحث بالرقم أو المدرسة أو الولاية"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="تصفية الحالة"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">البلاغات المفتوحة</option>
            <option value="all">كل الحالات مع الأرشيف</option>
            {Object.entries(statuses).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {role === 'admin' && (
            <select
              aria-label="تصفية قائد الفريق"
              value={leaderFilter}
              onChange={(e) => setLeaderFilter(e.target.value)}
            >
              <option value="all">كل القادة</option>
              <option value="unassigned">غير مسند</option>
              {leaders.map((l) => (
                <option key={l.user_id} value={l.user_id}>
                  {l.display_name}
                </option>
              ))}
            </select>
          )}
        </div>
        {role === 'leader' ? (
          <div className="ticket-cards">
            {visible.map((t) => (
              <article className="unit" key={t.id}>
                <h3>
                  #{t.ticket_number} — {t.school_name}
                </h3>
                <p>
                  {t.city === 'Saham' ? 'صحم' : 'الخابورة'} ·{' '}
                  {statuses[t.status] || t.status} · {t.ticket_units.length}{' '}
                  مكيفات
                </p>
                <button disabled={busy} onClick={() => openTicket(t.id)}>
                  فتح البلاغ
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم</th>
                  <th>المدرسة</th>
                  <th>المدينة</th>
                  <th>الحالة</th>
                  <th>المكيفات</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id}>
                    <td>#{t.ticket_number}</td>
                    <td>{t.school_name}</td>
                    <td>{t.city}</td>
                    <td>{statuses[t.status] || t.status}</td>
                    <td>{t.ticket_units.length}</td>
                    <td>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            hasDrafts &&
                            !confirm('توجد نتائج غير محفوظة، هل تريد تركها؟')
                          )
                            return;
                          setSelected(t.id);
                          setReturnReason('');
                        }}
                      >
                        فتح
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!visible.length && <p>لا توجد بلاغات متاحة.</p>}
      </section>
      {chosen && (
        <section className="card">
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <h2>
              بلاغ #{chosen.ticket_number} — {chosen.school_name}
            </h2>
            <button
              className="secondary"
              onClick={() => {
                if (
                  !hasDrafts ||
                  confirm('توجد نتائج غير محفوظة، هل تريد تركها؟')
                )
                  setSelected(null);
              }}
            >
              إغلاق التفاصيل
            </button>
          </div>
          <p>
            <Link href={'/reports/' + chosen.id} target="_blank">
              عرض التقرير / حفظ PDF
            </Link>
          </p>
          <p>
            الحالة: <strong>{statuses[chosen.status]}</strong> | التواصل:{' '}
            {chosen.contact_name || '—'} / {chosen.contact_phone}
          </p>
          <div className="unit">
            <h3>الوقت المستغرق في المدرسة</h3>
            {hasDrafts && (
              <p className="note" role="status">
                توجد نتائج غير محفوظة. احفظ نتيجة كل مكيف قبل إنهاء الزيارة.
              </p>
            )}
            <p>
              إجمالي الزيارات المنتهية: <strong>{fmt(seconds)}</strong> | عدد
              الزيارات: {visits.length}
            </p>
            {active && (
              <p>
                بدأ التنفيذ:{' '}
                {new Date(active.started_at).toLocaleString('ar-OM')} — الزيارة
                جارية
              </p>
            )}
            {visits
              .filter((v) => v.ended_at)
              .map((v) => (
                <p key={v.id}>
                  زيارة {new Date(v.started_at).toLocaleString('ar-OM')}:{' '}
                  {fmt(v.duration_seconds || 0)}
                </p>
              ))}
            {role === 'leader' &&
              !active &&
              ['assigned', 'pending_follow_up', 'revision_required'].includes(
                chosen.status,
              ) && (
                <button
                  disabled={busy}
                  onClick={() => action(chosen.id, { action: 'start' })}
                >
                  بدأ التنفيذ — وصلت إلى المدرسة
                </button>
              )}
            {role === 'leader' && active && missingOutcomes && (
              <p className="note" role="status">
                سجّل نتيجة كل مكيف: تم الإصلاح أو الاستبدال، أو يحتاج متابعة مع
                تحديد السبب، ثم احفظ قبل إنهاء الزيارة.
              </p>
            )}
            {role === 'leader' && active && (
              <button
                disabled={busy || hasDrafts || missingOutcomes}
                onClick={() => {
                  if (
                    confirm(
                      'هل انتهيت من تحديث نتائج المكيفات وتريد إنهاء زيارة المدرسة؟',
                    )
                  )
                    action(chosen.id, { action: 'finish' });
                }}
              >
                الانتهاء من الصيانة — إنهاء الزيارة
              </button>
            )}
          </div>
          {role === 'admin' &&
            !active &&
            ['submitted', 'assigned', 'pending_follow_up'].includes(
              chosen.status,
            ) && (
              <div className="actions">
                <label>
                  إسناد إلى قائد فريق
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        action(chosen.id, {
                          action: 'assign',
                          leaderId: e.target.value,
                        });
                    }}
                    disabled={busy}
                  >
                    <option value="">اختر قائد الفريق</option>
                    {leaders.map((l) => (
                      <option key={l.user_id} value={l.user_id}>
                        {l.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          {[...chosen.ticket_units]
            .sort((a, b) => a.item_number - b.item_number)
            .map((u) => (
              <UnitEditor
                key={u.id}
                unit={u}
                onDirty={markDirty}
                disabled={busy || !active || role !== 'leader'}
                onSave={(s, result, parts, reason) =>
                  action(chosen.id, {
                    action: 'unit',
                    unitId: u.id,
                    status: s,
                    maintenanceResult: result,
                    replacedParts: '',
                    parts,
                    followUpReason: reason,
                  })
                }
              />
            ))}
          {role === 'admin' && chosen.status === 'completed' && (
            <div className="card">
              <h3>مراجعة المدير</h3>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm('هل تؤكد اعتماد وإغلاق البلاغ نهائياً؟'))
                      action(chosen.id, { action: 'close' });
                  }}
                >
                  اعتماد وإغلاق
                </button>
              </div>
              <label>
                سبب إعادة التقرير (5 أحرف على الأقل)
                <textarea
                  maxLength={1000}
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="اكتب البيانات الناقصة التي يجب استكمالها"
                />
              </label>
              <button
                className="secondary"
                disabled={busy || returnReason.trim().length < 5}
                onClick={async () => {
                  const saved = await action(chosen.id, {
                    action: 'return_for_revision',
                    reason: returnReason.trim(),
                  });
                  if (saved) setReturnReason('');
                }}
              >
                إعادة لاستكمال البيانات
              </button>
            </div>
          )}
          {chosen.status === 'revision_required' && (
            <p className="error">
              أعيد البلاغ لاستكمال البيانات:{' '}
              {events.find((e) => e.ticket_id === chosen.id)?.details.reason ||
                'راجع المدير لمعرفة البيانات المطلوبة'}
              . افتح زيارة تصحيحية ثم أعد تقديمه للمراجعة.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
const followReasons = [
  ['parts', 'انتظار قطع غيار'],
  ['workshop', 'صيانة في الورشة'],
  ['approval', 'انتظار موافقة'],
  ['return_visit', 'زيارة أخرى'],
  ['other', 'سبب آخر'],
] as const;
function UnitEditor({
  unit,
  disabled,
  onSave,
  onDirty,
}: {
  unit: Unit;
  onDirty: (id: string, dirty: boolean) => void;
  disabled: boolean;
  onSave: (
    s: string,
    result: string,
    parts: PartItem[],
    reason: string | null,
  ) => void;
}) {
  const [status, setStatus] = useState(unit.status),
    [result, setResult] = useState(unit.maintenance_result || ''),
    [reason, setReason] = useState(unit.follow_up_reason || ''),
    [parts, setParts] = useState<PartItem[]>(unit.parts || []);
  const partValues = (items: PartItem[]) =>
    items.map((p) => [p.code, p.quantity, p.usage, p.name || '']);
  const draft = JSON.stringify([status, result, reason, partValues(parts)]);
  const saved = JSON.stringify([
    unit.status,
    unit.maintenance_result || '',
    unit.follow_up_reason || '',
    partValues(unit.parts || []),
  ]);
  const dirty = draft !== saved;
  useEffect(() => {
    onDirty(unit.id, dirty);
  }, [unit.id, dirty, onDirty]);
  useEffect(() => () => onDirty(unit.id, false), [unit.id, onDirty]);
  const toggle = (code: string, checked: boolean) =>
    setParts((old) =>
      checked
        ? [...old, { code, quantity: 1, usage: 'used' }]
        : old.filter((x) => x.code !== code),
    );
  const update = (code: string, patch: Partial<PartItem>) =>
    setParts((old) =>
      old.map((p) => (p.code === code ? { ...p, ...patch } : p)),
    );
  const invalid =
    (status === 'pending_follow_up' && !reason) ||
    (['completed', 'replaced'].includes(status) &&
      (!result.trim() || parts.some((p) => p.usage === 'required'))) ||
    parts.some(
      (p) =>
        (p.code === 'other' && !p.name?.trim()) ||
        !Number.isInteger(p.quantity) ||
        p.quantity < 1 ||
        p.quantity > 999,
    );
  return (
    <details className="unit">
      <summary>
        المكيف {unit.ac_number} — {unitStatuses[unit.status] || unit.status} |{' '}
        {unit.ac_location}
        {dirty ? ' — غير محفوظ' : ''}
      </summary>
      <h3>تسجيل نتيجة المكيف {unit.ac_number}</h3>
      <p>
        العطل: {unit.problem_type} | الموقع: {unit.ac_location}
      </p>
      {unit.school_notes && <p>ملاحظات المدرسة: {unit.school_notes}</p>}
      <label>
        نتيجة الصيانة
        <select
          disabled={disabled}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            if (e.target.value !== 'pending_follow_up') setReason('');
          }}
        >
          {Object.entries(unitStatuses).map(([v, t]) => (
            <option value={v} key={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {status === 'pending_follow_up' && (
        <label>
          سبب المتابعة (إلزامي)
          <select
            disabled={disabled}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">اختر السبب</option>
            {followReasons.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        تفاصيل العمل
        <textarea
          disabled={disabled}
          maxLength={2000}
          rows={2}
          value={result}
          onChange={(e) => setResult(e.target.value)}
        />
      </label>
      <details className="parts-panel">
        <summary>قطع الغيار والمواد ({parts.length})</summary>
        <fieldset disabled={disabled} className="parts-fieldset">
          <legend>قطع الغيار والمواد وأعمال الصيانة</legend>
          {PARTS.map((p) => {
            const selected = parts.find((x) => x.code === p.id);
            return (
              <div className="part-row" key={p.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!selected}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />{' '}
                  {p.ar} | {p.en}
                </label>
                {selected && (
                  <div className="part-fields">
                    <label>
                      الكمية
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={selected.quantity}
                        onChange={(e) =>
                          update(p.id, { quantity: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      الاستخدام
                      <select
                        value={selected.usage}
                        onChange={(e) =>
                          update(p.id, {
                            usage: e.target.value as PartItem['usage'],
                          })
                        }
                      >
                        <option value="used">تم استخدامه</option>
                        <option value="required">مطلوب للمتابعة</option>
                      </select>
                    </label>
                    {p.id === 'other' && (
                      <label>
                        اسم العنصر
                        <input
                          maxLength={120}
                          value={selected.name || ''}
                          onChange={(e) =>
                            update(p.id, { name: e.target.value })
                          }
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      </details>
      {!disabled && (
        <button
          disabled={!!invalid}
          onClick={() =>
            onSave(
              status,
              result,
              parts,
              status === 'pending_follow_up' ? reason : null,
            )
          }
        >
          حفظ نتيجة المكيف
        </button>
      )}
    </details>
  );
}
