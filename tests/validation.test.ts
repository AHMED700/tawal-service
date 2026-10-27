import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_TYPES } from '../lib/issues';
import { ticketSchema } from '../lib/schema';
import { POST } from '../app/api/tickets/route';
import { GET } from '../app/api/staff/tickets/route';
import { PATCH } from '../app/api/staff/tickets/[id]/route';
import schools from '../lib/schools.json';
const unit = {
  acNumber: '007',
  problemType: ISSUE_TYPES[1],
  location: 'الفصل 1',
};
const ticket = {
  schoolName: schools[0].name,
  schoolCode: schools[0].code,
  city: schools[0].city,
  phone: '99999999',
  units: [unit],
  captchaToken: 'test',
};
test('accepts a valid school ticket and preserves leading zeros', () => {
  assert.equal(ticketSchema.parse(ticket).units[0].acNumber, '007');
});
test('rejects duplicate normalized AC numbers', () => {
  assert.equal(
    ticketSchema.safeParse({
      ...ticket,
      units: [unit, { ...unit, acNumber: '7' }],
    }).success,
    false,
  );
});
test('rejects empty tickets, over 10 units and invalid AC numbers', () => {
  for (const units of [
    [],
    Array(11).fill(unit),
    [{ ...unit, acNumber: '١٢' }],
    [{ ...unit, acNumber: '1000' }],
  ])
    assert.equal(ticketSchema.safeParse({ ...ticket, units }).success, false);
});
const request = (body: string) =>
  new Request('http://localhost/api/tickets', { method: 'POST', body });
test('malformed JSON returns 400', async () =>
  assert.equal((await POST(request('{'))).status, 400));
test('oversized request returns 413', async () =>
  assert.equal((await POST(request('x'.repeat(20001)))).status, 413));
test('school identity mismatch returns 400', async () =>
  assert.equal(
    (
      await POST(
        request(JSON.stringify({ ...ticket, schoolName: 'غير موجودة' })),
      )
    ).status,
    400,
  ));
test('missing configuration fails closed with 503', async () => {
  const names = [
    'TURNSTILE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const old = names.map((n) => process.env[n]);
  try {
    names.forEach((n) => delete process.env[n]);
    assert.equal((await POST(request(JSON.stringify(ticket)))).status, 503);
  } finally {
    names.forEach((n, i) => {
      if (old[i] !== undefined) process.env[n] = old[i];
    });
  }
});
test('staff endpoints reject unauthenticated requests', async () => {
  assert.equal(
    (await GET(new Request('http://localhost/api/staff/tickets'))).status,
    401,
  );
  assert.equal(
    (
      await PATCH(
        new Request('http://localhost', { method: 'PATCH', body: '{}' }),
        {
          params: Promise.resolve({
            id: '00000000-0000-4000-8000-000000000000',
          }),
        },
      )
    ).status,
    401,
  );
});
test('Turnstile rejects invalid tokens, hostname mismatch and action mismatch', async () => {
  const names = [
    'TURNSTILE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TURNSTILE_EXPECTED_HOSTNAME',
  ];
  const old = names.map((n) => process.env[n]),
    originalFetch = globalThis.fetch;
  try {
    process.env.TURNSTILE_SECRET_KEY = 'unit-test-only';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
    process.env.TURNSTILE_EXPECTED_HOSTNAME = 'school.example';
    for (const result of [
      { success: false },
      { success: true, hostname: 'wrong.example', action: 'school_ticket' },
      { success: true, hostname: 'school.example', action: 'wrong_action' },
    ]) {
      globalThis.fetch = async () => Response.json(result);
      assert.equal((await POST(request(JSON.stringify(ticket)))).status, 403);
    }
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((n, i) => {
      if (old[i] === undefined) delete process.env[n];
      else process.env[n] = old[i];
    });
  }
});

test('all eight configured issue types pass and unknown types are rejected', () => {
  assert.equal(ISSUE_TYPES.length, 8);
  for (const problemType of ISSUE_TYPES)
    assert.equal(
      ticketSchema.safeParse({ ...ticket, units: [{ ...unit, problemType }] })
        .success,
      true,
    );
  assert.equal(
    ticketSchema.safeParse({
      ...ticket,
      units: [{ ...unit, problemType: 'نوع غير معتمد' }],
    }).success,
    false,
  );
});
