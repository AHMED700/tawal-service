import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
export const serverDb = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Database not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};
export async function staffFromRequest(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const db = serverDb();
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) return null;
  const userDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: profile } = await db
    .from('staff_profiles')
    .select('user_id,display_name,role,active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  return profile && ['admin', 'leader'].includes(profile.role)
    ? { ...profile, db: userDb, adminDb: db }
    : null;
}
export const failure = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });
