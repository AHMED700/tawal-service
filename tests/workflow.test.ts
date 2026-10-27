import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Entirely in-memory PostgreSQL. No URL, credentials or production connection.
const db = new PGlite({ extensions: { pgcrypto } });
const admin = '00000000-0000-4000-8000-000000000001';
const leader = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const inactive = '00000000-0000-4000-8000-000000000004';

before(async () => {
  await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
   $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
 `);
  const folder = new URL('../supabase/', import.meta.url);
  for (const name of (await readdir(folder))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(new URL(name, folder), 'utf8');
    if (name.startsWith('005_')) {
      // Commit enum change separately, exactly as the deployment guide requires.
      const split = sql.indexOf(';') + 1;
      await db.exec(sql.slice(0, split));
      await db.exec(sql.slice(split));
    } else await db.exec(sql);
  }
  for (const [id, role, active] of [
    [admin, 'admin', true],
    [leader, 'leader', true],
    [other, 'leader', true],
    [inactive, 'leader', false],
  ] as const) {
    await db.query('insert into auth.users(id) values($1)', [id]);
    await db.query('insert into public.staff_profiles values($1,$2,$3,$4)', [
      id,
      role,
      role,
      active,
    ]);
  }
});
after(async () => {
  await db.close();
});
async function one<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}
async function action(
  actor: string,
  id: string,
  type: string,
  payload: object = {},
) {
  await db.exec('set role service_role');
  try {
    return await one(
      'select public.staff_ticket_action($1,$2,$3,$4::jsonb) as result',
      [actor, id, type, JSON.stringify(payload)],
    );
  } finally {
    await db.exec('reset role');
  }
}
const unit = (number: string) => ({
  ac_number: number,
  problem_type: 'تبريد ضعيف',
  ac_location: 'الفصل التجريبي',
});
async function create(units = [unit('007')]) {
  const result = await one<{ number: number }>(
    'select public.create_school_ticket($1::jsonb) as number',
    [
      JSON.stringify({
        school_name: 'مدرسة اختبار محلية',
        school_code: '2202',
        city: 'Saham',
        contact_phone: '00000000',
        units,
      }),
    ],
  );
  return (
    await one<{ id: string }>('select id from tickets where ticket_number=$1', [
      result.number,
    ])
  ).id;
}
async function ticket(id: string) {
  return one<{ status: string; closed_at: Date | null }>(
    'select status,closed_at from tickets where id=$1',
    [id],
  );
}
async function unitId(id: string) {
  return (
    await one<{ id: string }>(
      'select id from ticket_units where ticket_id=$1 order by item_number limit 1',
      [id],
    )
  ).id;
}
async function asUser<T>(id: string, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

test('migrations load with 34 schools; duplicate/invalid AC creation rolls back atomically', async () => {
  assert.equal(
    (
      await one<{ count: number }>(
        'select count(*)::int as count from school_directory',
      )
    ).count,
    34,
  );
  const before = (
    await one<{ count: number }>('select count(*)::int as count from tickets')
  ).count;
  await assert.rejects(() => create([unit('007'), unit('7')]), /duplicate key/);
  await assert.rejects(
    () => create([unit('007'), unit('١٢')]),
    /ac_number_english_3_digits/,
  );
  assert.equal(
    (await one<{ count: number }>('select count(*)::int as count from tickets'))
      .count,
    before,
  );
});

test('only assigned active leader can start; results require active visit; duplicate start is rejected', async () => {
  const id = await create(),
    uid = await unitId(id);
  await assert.rejects(
    () => action(leader, id, 'assign', { leader_id: leader }),
    /Cannot assign/,
  );
  await assert.rejects(
    () => action(admin, id, 'assign', { leader_id: inactive }),
    /Invalid leader/,
  );
  await action(admin, id, 'assign', { leader_id: leader });
  await assert.rejects(
    () =>
      action(leader, id, 'unit', {
        unit_id: uid,
        status: 'completed',
        maintenance_result: 'تم الاختبار',
      }),
    /outside visit/,
  );
  await assert.rejects(() => action(other, id, 'start'), /Cannot start/);
  await action(leader, id, 'start');
  await assert.rejects(
    () => action(leader, id, 'start'),
    /Cannot start|Already started/,
  );
  await assert.rejects(
    () => action(admin, id, 'assign', { leader_id: other }),
    /Cannot assign|Active visit/,
  );
  assert.equal((await ticket(id)).status, 'in_progress');
});

test('follow-up, revisit, admin return and closure preserve durations and audit history', async () => {
  const id = await create(),
    uid = await unitId(id);
  await action(admin, id, 'assign', { leader_id: leader });
  await action(leader, id, 'start');
  await assert.rejects(
    () =>
      action(leader, id, 'unit', { unit_id: uid, status: 'pending_follow_up' }),
    /Follow-up reason/,
  );
  await assert.rejects(
    () =>
      action(leader, id, 'unit', {
        unit_id: uid,
        status: 'completed',
        maintenance_result: '  ',
      }),
    /Result required/,
  );
  await assert.rejects(
    () =>
      action(leader, id, 'unit', {
        unit_id: uid,
        status: 'completed',
        maintenance_result: 'تم',
        parts: [{ code: 'capacitor', quantity: 1, usage: 'required' }],
      }),
    /Required parts/,
  );
  await action(leader, id, 'unit', {
    unit_id: uid,
    status: 'pending_follow_up',
    follow_up_reason: 'parts',
    parts: [{ code: 'capacitor', quantity: 2, usage: 'required' }],
  });
  await db.query(
    "update ticket_work_sessions set started_at=clock_timestamp()-interval '2 minutes' where ticket_id=$1 and ended_at is null",
    [id],
  );
  await action(leader, id, 'finish');
  assert.equal((await ticket(id)).status, 'pending_follow_up');
  await assert.rejects(() => action(admin, id, 'close'), /Cannot close/);
  await action(leader, id, 'start');
  await action(leader, id, 'unit', {
    unit_id: uid,
    status: 'completed',
    maintenance_result: 'تم استبدال المكثفين واختبار التبريد',
    parts: [{ code: 'capacitor', quantity: 2, usage: 'used' }],
  });
  await action(leader, id, 'finish');
  assert.equal((await ticket(id)).status, 'completed');
  await assert.rejects(() => action(leader, id, 'close'), /Cannot close/);
  await assert.rejects(
    () => action(admin, id, 'return_for_revision', { reason: 'قصير' }),
    /Return reason/,
  );
  await action(admin, id, 'return_for_revision', {
    reason: 'أضف تفاصيل اختبار التبريد',
  });
  assert.equal((await ticket(id)).status, 'revision_required');
  await action(leader, id, 'start');
  await action(leader, id, 'finish');
  await action(admin, id, 'close');
  const closed = await ticket(id);
  assert.equal(closed.status, 'closed');
  assert.ok(closed.closed_at);
  const visits = (
    await db.query<{ duration_seconds: number }>(
      'select duration_seconds from ticket_work_sessions where ticket_id=$1',
      [id],
    )
  ).rows;
  assert.equal(visits.length, 3);
  assert.ok(visits.every((v) => v.duration_seconds >= 0));
  assert.ok(visits.reduce((n, v) => n + v.duration_seconds, 0) >= 120);
  const events = (
    await db.query<{ event_type: string }>(
      'select event_type from ticket_events where ticket_id=$1',
      [id],
    )
  ).rows.map((e) => e.event_type);
  for (const event of [
    'school_submitted',
    'assigned',
    'visit_started',
    'unit_updated',
    'visit_finished',
    'returned_for_revision',
    'closed',
  ])
    assert.ok(events.includes(event), event);
  await assert.rejects(() => action(leader, id, 'start'), /Cannot start/);
});

test('RLS isolates tickets, units, visits and review reasons; clients cannot mutate or call privileged RPC', async () => {
  const id = await create();
  await action(admin, id, 'assign', { leader_id: leader });
  await action(leader, id, 'start');
  await action(leader, id, 'unit', {
    unit_id: await unitId(id),
    status: 'completed',
    maintenance_result: 'نتيجة الاختبار',
  });
  await action(leader, id, 'finish');
  await action(admin, id, 'return_for_revision', {
    reason: 'تفاصيل إضافية للاختبار',
  });
  for (const table of [
    'tickets',
    'ticket_units',
    'ticket_work_sessions',
    'ticket_events',
  ]) {
    const predicate = table === 'tickets' ? 'id' : 'ticket_id';
    const sql = `select * from ${table} where ${predicate}=$1`;
    assert.ok(
      (await asUser(leader, sql, [id])).length > 0,
      table + ' assigned leader',
    );
    assert.equal(
      (await asUser(other, sql, [id])).length,
      0,
      table + ' other leader',
    );
    assert.ok((await asUser(admin, sql, [id])).length > 0, table + ' admin');
  }
  const events = await asUser<{ event_type: string }>(
    leader,
    'select event_type from ticket_events where ticket_id=$1',
    [id],
  );
  assert.deepEqual(
    events.map((e) => e.event_type),
    ['returned_for_revision'],
  );
  assert.equal(
    (
      await asUser<{ id: string }>(
        leader,
        "update tickets set status='closed' where id=$1 returning id",
        [id],
      )
    ).length,
    0,
  );
  assert.equal((await ticket(id)).status, 'revision_required');
  await assert.rejects(
    () =>
      asUser(leader, "select public.staff_ticket_action($1,$2,'close','{}')", [
        admin,
        id,
      ]),
    /permission denied/,
  );
  await assert.rejects(
    () => asUser(leader, "select public.create_school_ticket('{}')"),
    /permission denied/,
  );
  await db.exec('set role anon');
  try {
    for (const table of [
      'staff_profiles',
      'tickets',
      'ticket_units',
      'ticket_work_sessions',
      'ticket_events',
    ]) {
      assert.equal(
        (await db.query(`select * from ${table}`)).rows.length,
        0,
        table + ' anonymous access',
      );
    }
    await assert.rejects(
      () => db.query("select public.create_school_ticket('{}')"),
      /permission denied/,
    );
  } finally {
    await db.exec('reset role');
  }
  await db.query('update staff_profiles set active=false where user_id=$1', [
    leader,
  ]);
  try {
    assert.equal(
      (await asUser(leader, 'select id from tickets where id=$1', [id])).length,
      0,
    );
    await assert.rejects(() => action(leader, id, 'start'), /Not authorized/);
  } finally {
    await db.query('update staff_profiles set active=true where user_id=$1', [
      leader,
    ]);
  }
});

test('finishing requires a recorded outcome for every AC and failed finish keeps visit active', async () => {
  const id = await create([unit('001'), unit('002')]);
  const units = (
    await db.query<{ id: string }>(
      'select id from ticket_units where ticket_id=$1 order by item_number',
      [id],
    )
  ).rows;
  await action(admin, id, 'assign', { leader_id: leader });
  await action(leader, id, 'start');
  await action(leader, id, 'unit', {
    unit_id: units[0].id,
    status: 'completed',
    maintenance_result: 'تم الإصلاح',
  });
  await assert.rejects(
    () => action(leader, id, 'finish'),
    /Record all unit outcomes/,
  );
  assert.equal((await ticket(id)).status, 'in_progress');
  assert.equal(
    (
      await one<{ count: number }>(
        'select count(*)::int as count from ticket_work_sessions where ticket_id=$1 and ended_at is null',
        [id],
      )
    ).count,
    1,
  );
  await action(leader, id, 'unit', {
    unit_id: units[1].id,
    status: 'in_progress',
  });
  await assert.rejects(
    () => action(leader, id, 'finish'),
    /Record all unit outcomes/,
  );
  await action(leader, id, 'unit', {
    unit_id: units[1].id,
    status: 'pending_follow_up',
    follow_up_reason: 'workshop',
  });
  await action(leader, id, 'finish');
  assert.equal((await ticket(id)).status, 'pending_follow_up');
});
