import { createClient, SupabaseClient } from '@supabase/supabase-js';
let client: SupabaseClient | undefined;
export function browserDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('قاعدة البيانات غير مهيأة');
  return (client ??= createClient(url, key));
}
export async function accessToken() {
  const { data, error } = await browserDb().auth.getSession();
  if (error || !data.session)
    throw new Error('انتهت الجلسة، يرجى تسجيل الدخول');
  return data.session.access_token;
}
