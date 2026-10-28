import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PROJECT_REF = 'uhbxrnvlkrgsnonkajzy';
const JOURNAL = 'tawal_schema_migrations';
const CORE = {
  staff_profiles: ['user_id', 'display_name', 'role', 'active'],
  tickets: [
    'id',
    'ticket_number',
    'school_name',
    'school_code',
    'city',
    'contact_name',
    'contact_phone',
    'contact_email',
    'school_notes',
    'status',
    'assigned_leader_id',
    'created_at',
    'closed_at',
  ],
  ticket_units: [
    'id',
    'ticket_id',
    'item_number',
    'ac_number',
    'problem_type',
    'ac_location',
    'school_notes',
    'status',
    'maintenance_result',
    'replaced_parts',
  ],
  ticket_events: [
    'id',
    'ticket_id',
    'actor_id',
    'event_type',
    'details',
    'occurred_at',
  ],
};
const TABLES = [
  ...Object.keys(CORE),
  'ticket_work_sessions',
  'school_directory',
];
const names = TABLES.map((t) => `'${t}'`).join(',');
export const INSPECT_SQL = `select jsonb_build_object(
 'tables', coalesce((select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relname in (${names})), '[]'::jsonb),
 'columns', coalesce((select jsonb_object_agg(table_name, names) from (select table_name,jsonb_agg(column_name order by ordinal_position) names from information_schema.columns where table_schema='public' and table_name in (${names}) group by table_name) x), '{}'::jsonb),
 'rls', coalesce((select jsonb_object_agg(c.relname,c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${names})), '{}'::jsonb),
 'enums', coalesce((select jsonb_object_agg(typname, labels) from (select t.typname,jsonb_agg(e.enumlabel order by e.enumsortorder) labels from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='public' and t.typname in ('ticket_status','unit_status') group by t.typname) x), '{}'::jsonb),
 'functions', coalesce((select jsonb_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_school_ticket','staff_ticket_action')), '[]'::jsonb),
 'journal', to_regclass('public.${JOURNAL}') is not null
) as state`;

export async function loadSteps(
  folder = new URL('../supabase/', import.meta.url),
) {
  const files = (await readdir(folder))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n))
    .sort();
  const steps = [];
  for (const name of files) {
    const sql = await readFile(new URL(name, folder), 'utf8');
    if (name.startsWith('001_')) {
      const at = sql.indexOf('-- Only server-side service role');
      if (at < 0) throw new Error('Cannot identify schema boundary');
      steps.push(
        { name: '001_core', sql: sql.slice(0, at) },
        { name: '001_rpc', sql: sql.slice(at) },
      );
    } else if (name.startsWith('005_')) {
      const at = sql.indexOf(';') + 1;
      if (at < 1) throw new Error('Cannot identify enum boundary');
      steps.push(
        { name: '005_enum', sql: sql.slice(0, at) },
        { name: '005_function', sql: sql.slice(at) },
      );
    } else steps.push({ name, sql });
  }
  return steps.map((step) => ({
    ...step,
    checksum: createHash('sha256').update(step.sql).digest('hex'),
  }));
}

export function validateBaseline(state, counts) {
  if (state.tables.length === 0 && Object.keys(state.enums).length === 0)
    return 'empty';
  const tables = Object.keys(CORE);
  if (
    state.tables.length !== tables.length ||
    tables.some((n) => !state.tables.includes(n))
  )
    throw new Error(
      'Unrecognized partial schema: manual inspection required; nothing was changed',
    );
  for (const name of tables) {
    if (
      JSON.stringify(state.columns[name]) !== JSON.stringify(CORE[name]) ||
      !state.rls[name]
    )
      throw new Error(
        'Existing core schema or RLS differs from the reviewed baseline',
      );
    if (counts[name] !== 0)
      throw new Error(
        'Existing application data found: automatic bootstrap refused',
      );
  }
  const enums = {
    ticket_status: [
      'submitted',
      'assigned',
      'in_progress',
      'pending_follow_up',
      'completed',
      'closed',
    ],
    unit_status: [
      'pending',
      'in_progress',
      'pending_follow_up',
      'completed',
      'replaced',
    ],
  };
  if (
    JSON.stringify(state.enums.ticket_status) !==
      JSON.stringify(enums.ticket_status) ||
    JSON.stringify(state.enums.unit_status) !==
      JSON.stringify(enums.unit_status)
  )
    throw new Error('Unexpected enum state: manual inspection required');
  return 'core';
}

export function stepTransaction(step, adoptedCore = false) {
  const sql = adoptedCore ? 'select 1;' : step.sql;
  if (
    !/^[a-zA-Z0-9_.]+$/.test(step.name) ||
    !/^[a-f0-9]{64}$/.test(step.checksum) ||
    sql.includes('$tawal_sql$')
  )
    throw new Error('Invalid migration step');
  return `DO $tawal_guard$
BEGIN
 LOCK TABLE public.${JOURNAL} IN EXCLUSIVE MODE;
 IF EXISTS(select 1 from public.${JOURNAL} where step='${step.name}' and checksum<>'${step.checksum}') THEN
  RAISE EXCEPTION 'Migration checksum mismatch';
 ELSIF NOT EXISTS(select 1 from public.${JOURNAL} where step='${step.name}') THEN
  EXECUTE $tawal_sql$${sql}$tawal_sql$;
  INSERT INTO public.${JOURNAL}(step,checksum) values('${step.name}','${step.checksum}');
 END IF;
END;
$tawal_guard$;`;
}

export async function runSetup(
  query,
  steps,
  { apply = false, onStep = (_name) => {} } = {},
) {
  let state = (await query(INSPECT_SQL))[0].state;
  if (!apply) return state;
  let baseline;
  if (!state.journal) {
    const counts = {};
    for (const name of Object.keys(CORE).filter((n) =>
      state.tables.includes(n),
    ))
      counts[name] = (
        await query(`select count(*)::int as count from public.${name}`)
      )[0].count;
    baseline = validateBaseline(state, counts);
    const core = steps.find((s) => s.name === '001_core');
    if (!core) throw new Error('Missing core migration');
    const adopt =
      baseline === 'core'
        ? `INSERT INTO public.${JOURNAL}(step,checksum) VALUES('001_core','${core.checksum}') ON CONFLICT DO NOTHING;`
        : '';
    await query(
      `DO $tawal_init$ BEGIN CREATE TABLE IF NOT EXISTS public.${JOURNAL}(step text primary key,checksum text not null,applied_at timestamptz not null default now()); ALTER TABLE public.${JOURNAL} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.${JOURNAL} FROM PUBLIC,anon,authenticated; ${adopt} END; $tawal_init$;`,
    );
  }
  const applied = await query(`select step,checksum from public.${JOURNAL}`);
  for (const row of applied) {
    const source = steps.find((s) => s.name === row.step);
    if (!source || source.checksum !== row.checksum)
      throw new Error(
        'Migration journal differs from source; automatic execution stopped',
      );
  }
  for (const step of steps) {
    if (applied.some((row) => row.step === step.name)) continue;
    try {
      await query(
        stepTransaction(step, baseline === 'core' && step.name === '001_core'),
      );
    } catch {
      throw new Error(
        `Migration step failed: ${step.name}; stopped without exposing SQL or response data`,
      );
    }
    onStep(step.name);
  }
  state = (await query(INSPECT_SQL))[0].state;
  if (
    TABLES.some((t) => !state.tables.includes(t)) ||
    [...Object.keys(CORE), 'ticket_work_sessions'].some((t) => !state.rls[t]) ||
    !state.enums.ticket_status?.includes('revision_required') ||
    ['parts', 'follow_up_reason'].some(
      (c) => !state.columns.ticket_units?.includes(c),
    ) ||
    ['create_school_ticket', 'staff_ticket_action'].some(
      (f) => !state.functions.includes(f),
    )
  )
    throw new Error('Final schema is incomplete');
  const directory = await query(
    'select count(*)::int as count from public.school_directory',
  );
  if (directory[0]?.count !== 34)
    throw new Error(
      'Final schema is incomplete: school directory count differs from reviewed source',
    );
  return state;
}

export function managementQuery({ token, projectUrl, fetcher = fetch }) {
  if (!token)
    throw new Error(
      'SUPABASE_ACCESS_TOKEN must be provided in secure environment settings',
    );
  if (
    (projectUrl || '').replace(/\/$/, '') !==
    `https://${PROJECT_REF}.supabase.co`
  )
    throw new Error('Selected project does not match the approved project');
  return async (query) => {
    const response = await fetcher(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Management SQL request failed (HTTP ${response.status}); response body omitted`,
      );
    const rows = await response.json();
    if (!Array.isArray(rows))
      throw new Error('Unexpected management API response');
    return rows;
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((a) => a !== '--apply'))
      throw new Error('Only --apply is supported; default mode is read-only');
    const query = managementQuery({
      token: process.env.SUPABASE_ACCESS_TOKEN,
      projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
    const state = await runSetup(query, await loadSteps(), {
      apply: args.includes('--apply'),
      onStep: (name) => console.log('Applied:', name),
    });
    console.log(
      JSON.stringify({
        project: PROJECT_REF,
        tables: state.tables,
        rls: state.rls,
        hasJournal: state.journal,
      }),
    );
  } catch (error) {
    const safe =
      error instanceof Error &&
      /^(SUPABASE_ACCESS_TOKEN|Selected project|Only --apply|Management SQL request failed|Unexpected management API response|Unrecognized partial schema|Existing core schema|Existing application data|Unexpected enum state|Migration journal differs|Migration step failed|Final schema is incomplete)/.test(
        error.message,
      );
    console.error(
      safe
        ? error.message
        : 'Setup failed; raw SQL/API response and credentials omitted. Inspect the last step before retrying.',
    );
    process.exitCode = 1;
  }
}
