'use client';
import { ISSUE_TYPES } from '../lib/issues';
import { Turnstile } from '../components/turnstile';
import schools from '../lib/schools.json';
import { useState } from 'react';
type Unit = {
  acNumber: string;
  problemType: string;
  location: string;
  notes: string;
};
const acError = (value: string, units: Unit[], index: number) => {
  if (!value) return '';
  if (!/^[0-9]{1,3}$/.test(value))
    return 'يرجى إدخال رقم المكيف بالأرقام الإنجليزية فقط (0–9)، وبحد أقصى 3 خانات';
  if (
    units.some(
      (other, j) =>
        j !== index &&
        /^[0-9]{1,3}$/.test(other.acNumber) &&
        Number(other.acNumber) === Number(value),
    )
  )
    return 'رقم هذا المكيف مضاف مسبقاً';
  return '';
};
const empty = (): Unit => ({
  acNumber: '',
  problemType: '',
  location: '',
  notes: '',
});
export default function Home() {
  const [units, setUnits] = useState<Unit[]>([empty()]);
  const [fields, setFields] = useState({
    schoolName: '',
    schoolCode: '',
    city: '',
    contactName: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaVersion, setCaptchaVersion] = useState(0);
  function setField(k: keyof typeof fields, v: string) {
    setFields((s) => ({ ...s, [k]: v }));
  }
  function changeUnit(i: number, k: keyof Unit, v: string) {
    setUnits((s) => s.map((u, j) => (i === j ? { ...u, [k]: v } : u)));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !schools.some(
        (s) =>
          s.code === fields.schoolCode &&
          s.city === fields.city &&
          s.name === fields.schoolName,
      )
    ) {
      setMessage('يرجى اختيار المدرسة من القائمة');
      return;
    }
    const seen = new Set<number>();
    for (const unit of units) {
      if (!/^[0-9]{1,3}$/.test(unit.acNumber)) {
        setMessage('رقم المكيف يجب أن يتكون من 1 إلى 3 أرقام إنجليزية فقط');
        return;
      }
      const number = Number(unit.acNumber);
      if (seen.has(number)) {
        setMessage('رقم هذا المكيف مضاف مسبقاً: ' + unit.acNumber);
        return;
      }
      seen.add(number);
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, units, captchaToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إرسال البلاغ');
      setMessage('تم تسجيل البلاغ بنجاح. رقم البلاغ: ' + data.ticketNumber);
      setUnits([empty()]);
      setFields({
        schoolName: '',
        schoolCode: '',
        city: '',
        contactName: '',
        phone: '',
        email: '',
        notes: '',
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setBusy(false);
      setCaptchaToken('');
      setCaptchaVersion((v) => v + 1);
    }
  }
  return (
    <main>
      <h1>بلاغ صيانة مكيفات المدارس – توال العالمية</h1>
      <p>
        أدخل بيانات المدرسة والمكيفات المطلوب صيانتها (حتى 10 مكيفات في البلاغ).
      </p>
      <form onSubmit={submit}>
        <section className="card">
          <h2>1. بيانات المدرسة</h2>
          <div className="grid">
            <label>
              الولاية | City *
              <select
                required
                value={fields.city}
                onChange={(e) =>
                  setFields((v) => ({
                    ...v,
                    city: e.target.value,
                    schoolCode: '',
                    schoolName: '',
                  }))
                }
              >
                <option value="">اختر الولاية</option>
                <option value="Saham">صحم | Saham</option>
                <option value="Khaboura">الخابورة | Khaburah</option>
              </select>
            </label>
            <label>
              المدرسة | School *
              <select
                required
                disabled={!fields.city}
                value={fields.schoolCode}
                onChange={(e) => {
                  const school = schools.find(
                    (s) => s.code === e.target.value && s.city === fields.city,
                  );
                  setFields((v) => ({
                    ...v,
                    schoolCode: school?.code || '',
                    schoolName: school?.name || '',
                  }));
                }}
              >
                <option value="">
                  {fields.city ? 'اختر المدرسة' : 'اختر الولاية أولاً'}
                </option>
                {schools
                  .filter((s) => s.city === fields.city)
                  .map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} | {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              اسم مسؤول التواصل (اختياري)
              <input
                maxLength={120}
                value={fields.contactName}
                onChange={(e) => setField('contactName', e.target.value)}
              />
            </label>
            <label>
              رقم الهاتف | Contact Number *
              <input
                required
                type="tel"
                maxLength={25}
                value={fields.phone}
                onChange={(e) => setField('phone', e.target.value)}
              />
            </label>
          </div>
          <label>
            ملاحظات المدرسة (اختياري)
            <textarea
              rows={3}
              maxLength={1000}
              value={fields.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </label>
        </section>
        <section className="card">
          <h2>2. المكيفات المطلوب صيانتها ({units.length}/10)</h2>
          {units.map((u, i) => (
            <div className="unit" key={i}>
              <div className="unit-head">
                <h3>المكيف {i + 1}</h3>
                {units.length > 1 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setUnits((s) => s.filter((_, j) => j !== i))}
                  >
                    حذف
                  </button>
                )}
              </div>
              <div className="grid">
                <label>
                  رقم المكيف | AC Number *
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    aria-invalid={!!acError(u.acNumber, units, i)}
                    dir="ltr"
                    pattern="[0-9]{1,3}"
                    title="أدخل من 1 إلى 3 أرقام إنجليزية فقط"
                    maxLength={3}
                    placeholder="001"
                    value={u.acNumber}
                    onChange={(e) => changeUnit(i, 'acNumber', e.target.value)}
                  />
                  {acError(u.acNumber, units, i) && (
                    <small className="field-error" role="alert">
                      {acError(u.acNumber, units, i)}
                    </small>
                  )}
                </label>
                <label>
                  نوع العطل *
                  <select
                    required
                    value={u.problemType}
                    onChange={(e) =>
                      changeUnit(i, 'problemType', e.target.value)
                    }
                  >
                    <option value="">اختر نوع العطل</option>
                    {ISSUE_TYPES.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  موقع المكيف *
                  <input
                    required
                    maxLength={120}
                    value={u.location}
                    onChange={(e) => changeUnit(i, 'location', e.target.value)}
                  />
                </label>
                <label>
                  ملاحظات (اختياري)
                  <input
                    maxLength={500}
                    value={u.notes}
                    onChange={(e) => changeUnit(i, 'notes', e.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            className="secondary"
            type="button"
            disabled={units.length >= 10}
            onClick={() => setUnits((s) => [...s, empty()])}
          >
            + إضافة مكيف آخر | Add AC
          </button>
          {units.length >= 10 && (
            <p className="note">الحد الأقصى 10 مكيفات في الطلب الواحد.</p>
          )}
        </section>
        <section className="card">
          <Turnstile key={captchaVersion} onToken={setCaptchaToken} />
          <div className="actions">
            <button disabled={busy || !captchaToken}>
              {busy ? 'جارٍ الإرسال...' : 'إرسال البلاغ'}
            </button>
          </div>
          <p role="status" aria-live="polite">
            {message}
          </p>
        </section>
      </form>
    </main>
  );
}
