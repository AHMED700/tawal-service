'use client';
import { useState } from 'react';
import { browserDb, accessToken } from '../../lib/browser-db';
import { useRouter } from 'next/navigation';
export default function Login() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
        key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('يلزم ربط قاعدة البيانات أولاً');
      const db = browserDb();
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      router.push('/dashboard');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'تعذر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <section className="card">
        <h1>دخول الإدارة وقادة الفرق</h1>
        <p>الحسابات ينشئها مسؤول النظام فقط. لا يوجد تسجيل عام للموظفين.</p>
        <form onSubmit={login}>
          <label>
            البريد الإلكتروني
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            كلمة المرور
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>{busy ? 'جارٍ الدخول...' : 'دخول'}</button>
          <p className="error" role="status">
            {message}
          </p>
        </form>
      </section>
    </main>
  );
}
