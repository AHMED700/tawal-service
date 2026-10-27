# Tawal International — PROJECT_CONTEXT
Last context update: 2026-10-27
Status: requirements and prototype source exist; NOT production-ready.

## Purpose
Simple responsive Arabic RTL web system for managing school air-conditioning maintenance in Saham (صحم) and Al Khaburah (الخابورة), Oman. Arabic/English labels where useful. Prioritize simplicity and mobile use. Do not create a new project from scratch.

## User roles
1. School requester: public ticket form, no login, cannot see internal operational details.
2. Admin: sees all tickets, assigns to one of three field leaders (two main, one reserve), reviews and closes, views reports and duration by school/team.
3. Field leader: sees assigned tickets only, starts work, records outcome per AC, parts and follow-up, finishes visit. No separate technician accounts in MVP.
No accountant login; Daftra remains separate.

## School form
- Select wilayat: Saham or Al Khaburah; then school dropdown filtered by wilayat, displaying school code and name. Do not permit free-text school names.
- School directory: Excel supplied in conversation, reportedly 34 records (20 Saham, 14 Al Khaburah). Treat actual spreadsheet as authoritative; verify before import. No need to invent missing school names.
- Contact phone; 1–10 AC units per ticket; each with AC number, issue type, location/room and optional notes.
- AC number must be 1–3 ASCII digits 0-9, not Arabic/Persian digits, with inline validation; no duplicates within the same ticket, including numeric equivalents such as 7 and 007. Preserve leading zeros for display if required.
- Issue types bilingual: Not Working / لا يعمل; Poor Cooling / تبريد ضعيف; Water Leakage / تسريب ماء; Unusual Noise / صوت غير طبيعي; Shuts Off / يفصل أثناء التشغيل; Icing / تكوّن الثلج; Bad Smell / يصدر رائحة; Other / أخرى.
- Confirmation after submit with ticket number. Public endpoint must have validation, abuse protection and safe data handling.

## Ticket workflow
Submitted/New -> Assigned -> In Progress -> Completed OR Pending Follow-up -> Closed (admin approval only).
- Leader presses «بدأ التنفيذ» on arrival, which starts visit timer.
- Leader presses «الانتهاء من الصيانة» to end visit and stop timer.
- Multiple visits supported; retain each visit duration and total. Do not manually ask leader to enter time.
- Each AC has its own result. Ticket cannot be completed until all AC outcomes are resolved (completed or replaced); otherwise pending follow-up.
- Follow-up reason required: awaiting parts, workshop, approval, return visit, other.
- Completed means field work reported finished; Closed means admin reviewed and approved.
- Admin can return completed report for correction, with mandatory reason; keep prior visit times and audit history.
- Record audit trail for assignments, starts, finishes, returns, approvals, closures.

## Maintenance results and parts
Results per AC: Completed / تمت الصيانة; Replaced / تمت مع استبدال; Another Visit Needed / يحتاج زيارة أخرى; Workshop Repair / يحتاج صيانة في الورشة; Awaiting Parts / انتظار قطع غيار.
Parts/actions multi-select, quantity for each, used vs required:
Capacitor / مكثف; Fan Capacitor / مكثف المروحة; PCB / لوحة إلكترونية; Refrigerant Gas / غاز تبريد; Outdoor Fan Motor / محرك مروحة خارجية; Indoor Fan Motor / محرك مروحة داخلية; Cross Flow Fan / مروحة داخلية أسطوانية; Filter Cleaning / تنظيف الفلتر; AC Switch / مفتاح مكيف; Other / أخرى (custom label).
Keep parts section collapsed unless needed.

## UI simplicity
School: select wilayat -> school -> AC details -> submit.
Leader: open assigned ticket -> start work -> record per-AC result -> finish. Mobile cards, not wide tables.
Admin quick views: New/awaiting assignment; In progress/assigned; Needs follow-up; Awaiting approval; archived closed via search. Search by ticket, school, wilayat; filters by status and leader.
Do not add complex inventory, extra technician roles, native app or Daftra integration in MVP.

## Reports
Bilingual blue/teal company report, school details, each AC's issue/result/parts/quantities, leader, time per visit and total. Printable multi-page PDF. Distinguish public/internal details where necessary.

## Tech and delivery
Existing prototypes use Next.js, Supabase PostgreSQL/Auth/RLS. Enforce permissions server-side and with RLS, validate all public inputs, use atomic state transitions, never commit .env or credentials.
Repository: AHMED700/tawal-service.
Codex must first inspect repo and any provided ZIP before modifying. Latest ZIP actually supplied by user in conversation: tawal-service-v11(1).zip. Earlier V12 was mentioned in chat but may not be present in repository. Do not claim it is uploaded.
At last inspection repository contained only README.md. This context file does NOT mean application code is uploaded.
Do not deploy, configure production DB or expose credentials without explicit user approval.

## Next steps
1. Obtain/inspect source ZIP; upload source to a branch/repo excluding secrets.
2. Install dependencies, run build and checks; fix errors without expanding scope.
3. Apply DB migrations to a TEST Supabase project, validate auth/RLS and all workflows.
4. Test mobile school submission, duplicates/ASCII digits, leader timers, follow-up, admin closure, reports.
5. Only then prepare deployment and pilot rollout.

## Communication
Explain progress in Arabic, clearly distinguish coded, tested, and deployed. Keep instructions nontechnical and brief for the owner.
