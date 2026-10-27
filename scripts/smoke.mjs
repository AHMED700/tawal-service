import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
const base = process.env.TAWAL_BASE_URL || 'http://127.0.0.1:3000';
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    if ((await fetch(base, { signal: AbortSignal.timeout(2000) })).ok) {
      ready = true;
      break;
    }
  } catch {}
  await setTimeout(500);
}
assert.ok(ready, 'Local server did not become ready');
for (const [path, text] of [
  ['/', 'بلاغ صيانة'],
  ['/login', 'دخول الإدارة'],
  ['/dashboard', 'لوحة الصيانة'],
]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  assert.ok(
    (await response.text()).includes(text),
    path + ' must render its expected interface',
  );
}
assert.equal((await fetch(base + '/api/staff/tickets')).status, 401);
assert.equal(
  (await fetch(base + '/api/tickets', { method: 'POST', body: '{' })).status,
  400,
);
assert.equal(
  (
    await fetch(base + '/api/tickets', {
      method: 'POST',
      body: 'x'.repeat(20001),
    })
  ).status,
  413,
);
console.log(
  'HTTP smoke passed: 3 rendered pages, anonymous staff access denied, malformed and oversized ticket requests rejected.',
);
