import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const page = read('app/page.tsx');
assert.match(page, /^'use client';/, 'Next.js client directive must be first');
assert.match(read('app/reports/[id]/page.tsx'), /^'use client';/);
assert.ok(existsSync(new URL('supabase/008_review_events_access.sql', root)));
const schools = JSON.parse(read('lib/schools.json'));
assert.equal(schools.length, 34, 'Expected 34 schools');
assert.equal(schools.filter((s) => s.city === 'Saham').length, 20);
assert.equal(schools.filter((s) => s.city === 'Khaboura').length, 14);
assert.equal(
  new Set(schools.map((s) => s.code)).size,
  schools.length,
  'Duplicate school codes',
);
for (let i = 1; i <= 7; i++)
  assert.ok(
    existsSync(
      new URL(
        `supabase/${String(i).padStart(3, '0')}_` +
          {
            1: 'schema',
            2: 'staff_actions',
            3: 'access_and_work_sessions',
            4: 'followup_and_parts',
            5: 'admin_review',
            6: 'ac_number_validation',
            7: 'school_directory',
          }[i] +
          '.sql',
        root,
      ),
    ),
  );
assert.match(read('lib/schema.ts'), /acNumber/);
console.log(
  'Source checks passed: client directive, 34 schools, 8 migrations, AC schema.',
);
