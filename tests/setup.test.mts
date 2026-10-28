import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  loadSteps,
  runSetup,
  managementQuery,
  PROJECT_REF,
} from '../scripts/setup-supabase.mjs';

async function fixture(
  run: (
    db: PGlite,
    steps: Awaited<ReturnType<typeof loadSteps>>,
  ) => Promise<void>,
) {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`,
    );
    await run(db, await loadSteps());
  } finally {
    await db.close();
  }
}
const adapter = (db: PGlite) => async (sql: string) => {
  if (sql.trimStart().startsWith('select')) return (await db.query(sql)).rows;
  await db.exec(sql);
  return [];
};

test('setup status is read-only and fresh bootstrap applies complete SQL atomically per step', async () => {
  await fixture(async (db, steps) => {
    const query = adapter(db);
    const status = await runSetup(query, steps);
    assert.deepEqual(status.tables, []);
    assert.equal(status.journal, false);
    const applied: string[] = [];
    const result = await runSetup(query, steps, {
      apply: true,
      onStep: (name: string) => applied.push(name),
    });
    assert.equal(result.tables.length, 6);
    assert.equal(result.journal, true);
    assert.equal(applied.length, steps.length);
    const schools = await db.query<{ count: number }>(
      'select count(*)::int as count from school_directory',
    );
    assert.equal(schools.rows[0].count, 34);
    assert.ok(result.enums.ticket_status.includes('revision_required'));
    const rerun: string[] = [];
    await runSetup(query, steps, {
      apply: true,
      onStep: (name: string) => rerun.push(name),
    });
    assert.deepEqual(rerun, []);
    await db.exec('set role authenticated');
    try {
      await assert.rejects(
        () => db.query('select * from tawal_schema_migrations'),
        /permission denied/,
      );
    } finally {
      await db.exec('reset role');
    }
    const sql = 'create table public.failed_setup_fixture(id int);select 1/0;';
    const failed = {
      name: '010_fail.sql',
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
    await assert.rejects(
      () => runSetup(query, [...steps, failed], { apply: true }),
      /Migration step failed: 010_fail.sql/,
    );
    assert.equal(
      (
        await db.query<{ name: string | null }>(
          "select to_regclass('public.failed_setup_fixture')::text as name",
        )
      ).rows[0].name,
      null,
    );
    assert.equal(
      (
        await db.query(
          "select * from tawal_schema_migrations where step='010_fail.sql'",
        )
      ).rows.length,
      0,
    );
    const changed = steps.map((step, index) =>
      index === 1 ? { ...step, checksum: '0'.repeat(64) } : step,
    );
    await assert.rejects(
      () => runSetup(query, changed, { apply: true }),
      /journal differs/,
    );
  });
});

test('setup resumes from approved empty core without recreating it, even after interrupted initialization', async () => {
  await fixture(async (db, steps) => {
    await db.exec(steps[0].sql);
    const query = adapter(db);
    let interrupted = false;
    const interrupt = async (sql: string) => {
      if (sql.startsWith('select step,checksum') && !interrupted) {
        interrupted = true;
        throw new Error('simulated disconnect');
      }
      return query(sql);
    };
    await assert.rejects(
      () => runSetup(interrupt, steps, { apply: true }),
      /simulated disconnect/,
    );
    const result = await runSetup(query, steps, { apply: true });
    assert.equal(result.tables.length, 6);
    const core = await db.query(
      "select * from tawal_schema_migrations where step='001_core'",
    );
    assert.equal(core.rows.length, 1);
  });
});

test('setup refuses unknown partial schema, disabled RLS and existing business data without creating journal', async () => {
  await fixture(async (db, steps) => {
    const query = adapter(db);
    await db.exec('create table public.tickets(id uuid primary key)');
    await assert.rejects(
      () => runSetup(query, steps, { apply: true }),
      /Unrecognized partial schema/,
    );
    assert.equal((await runSetup(query, steps)).journal, false);
    await db.exec('drop table public.tickets');
    await db.exec(steps[0].sql);
    await db.exec('alter table tickets disable row level security');
    await assert.rejects(
      () => runSetup(query, steps, { apply: true }),
      /core schema or RLS differs/,
    );
    await db.exec('alter table tickets enable row level security');
    await db.exec(
      "insert into tickets(school_name,city,contact_phone) values('local fixture','Saham','00000000')",
    );
    await assert.rejects(
      () => runSetup(query, steps, { apply: true }),
      /Existing application data/,
    );
    assert.equal((await runSetup(query, steps)).journal, false);
  });
});

test('management transport requires credentials and exact approved project, sanitizes errors and never changes endpoint', async () => {
  assert.throws(
    () => managementQuery({ token: '', projectUrl: '' }),
    /SUPABASE_ACCESS_TOKEN/,
  );
  assert.throws(
    () =>
      managementQuery({
        token: 'test-only',
        projectUrl: 'https://other.supabase.co',
      }),
    /Selected project/,
  );
  const requests: { url: string; body: unknown }[] = [];
  const fetcher = async (url: unknown, options?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(options?.body)),
    });
    return Response.json([{ state: { tables: [] } }]);
  };
  const query = managementQuery({
    token: 'test-only',
    projectUrl: `https://${PROJECT_REF}.supabase.co`,
    fetcher,
  });
  assert.deepEqual(await query('select 1'), [{ state: { tables: [] } }]);
  assert.equal(
    requests[0].url,
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  );
  assert.deepEqual(requests[0].body, { query: 'select 1' });
  const denied = managementQuery({
    token: 'test-only',
    projectUrl: `https://${PROJECT_REF}.supabase.co`,
    fetcher: async () =>
      new Response('sensitive body must never be logged', { status: 403 }),
  });
  await assert.rejects(
    () => denied('select 1'),
    (e) =>
      e instanceof Error &&
      e.message.includes('HTTP 403') &&
      !e.message.includes('sensitive'),
  );
});
