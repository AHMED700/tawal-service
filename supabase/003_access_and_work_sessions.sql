
-- Apply after 001_schema.sql and 002_staff_actions.sql.
-- Authenticated reads only. All writes remain server-side RPC operations.
create or replace function public.is_active_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.staff_profiles p where p.user_id=(select auth.uid()) and p.role='admin' and p.active) $$;
create or replace function public.is_ticket_leader(p_ticket uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.tickets t join public.staff_profiles p on p.user_id=t.assigned_leader_id where t.id=p_ticket and p.user_id=(select auth.uid()) and p.role='leader' and p.active) $$;
create policy staff_read on public.staff_profiles for select to authenticated using(user_id=(select auth.uid()) or public.is_active_admin());
create policy tickets_read on public.tickets for select to authenticated using(public.is_active_admin() or public.is_ticket_leader(id));
create policy units_read on public.ticket_units for select to authenticated using(public.is_active_admin() or public.is_ticket_leader(ticket_id));

-- A school can require more than one visit. Duration is calculated from the
-- database clock; client devices never supply timestamps.
create table public.ticket_work_sessions(
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.tickets(id) on delete cascade,
 leader_id uuid not null references public.staff_profiles(user_id),
 started_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz,
 duration_seconds integer generated always as
  (case when ended_at is null then null else greatest(0,extract(epoch from ended_at-started_at)::integer) end) stored,
 constraint session_end_after_start check(ended_at is null or ended_at>=started_at)
);
create unique index one_open_session_per_ticket on public.ticket_work_sessions(ticket_id) where ended_at is null;
create index ticket_sessions_idx on public.ticket_work_sessions(ticket_id,started_at desc);
alter table public.ticket_work_sessions enable row level security;
create policy sessions_read on public.ticket_work_sessions for select to authenticated
using(public.is_active_admin() or public.is_ticket_leader(ticket_id));

-- Replace the previous RPC to enforce a deliberate start/end workflow.
create or replace function public.staff_ticket_action(p_actor uuid,p_ticket uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_role text; v_status public.ticket_status; v_leader uuid; v_unit uuid;
 v_unit_status public.unit_status; v_pending integer; v_count integer;
 v_session uuid; v_started timestamptz; v_ended timestamptz;
begin
 select role into v_role from public.staff_profiles where user_id=p_actor and active=true;
 if v_role is null then raise exception 'Not authorized'; end if;
 select status,assigned_leader_id into v_status,v_leader from public.tickets where id=p_ticket for update;
 if not found then raise exception 'Ticket not found'; end if;

 if p_action='assign' then
  if v_role<>'admin' or v_status not in ('submitted','assigned','pending_follow_up') then raise exception 'Cannot assign'; end if;
  if exists(select 1 from public.ticket_work_sessions where ticket_id=p_ticket and ended_at is null) then raise exception 'Active visit'; end if;
  v_leader:=(p_payload->>'leader_id')::uuid;
  if not exists(select 1 from public.staff_profiles where user_id=v_leader and role='leader' and active=true) then raise exception 'Invalid leader'; end if;
  update public.tickets set assigned_leader_id=v_leader,status='assigned' where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
   values(p_ticket,p_actor,'assigned',jsonb_build_object('leader_id',v_leader));

 elsif p_action='start' then
  if v_role<>'leader' or v_leader is distinct from p_actor or v_status not in ('assigned','pending_follow_up') then raise exception 'Cannot start'; end if;
  if exists(select 1 from public.ticket_work_sessions where ticket_id=p_ticket and ended_at is null) then raise exception 'Already started'; end if;
  insert into public.ticket_work_sessions(ticket_id,leader_id) values(p_ticket,p_actor) returning id,started_at into v_session,v_started;
  update public.tickets set status='in_progress' where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
   values(p_ticket,p_actor,'visit_started',jsonb_build_object('session_id',v_session));
  return jsonb_build_object('ok',true,'started_at',v_started);

 elsif p_action='unit' then
  if v_role<>'leader' or v_leader is distinct from p_actor or v_status<>'in_progress' then raise exception 'Cannot update unit outside visit'; end if;
  if not exists(select 1 from public.ticket_work_sessions where ticket_id=p_ticket and leader_id=p_actor and ended_at is null) then raise exception 'Start visit first'; end if;
  v_unit:=(p_payload->>'unit_id')::uuid;
  v_unit_status:=(p_payload->>'status')::public.unit_status;
  if v_unit_status in ('completed','replaced') and nullif(btrim(p_payload->>'maintenance_result'),'') is null then raise exception 'Result required'; end if;
  if length(coalesce(p_payload->>'maintenance_result',''))>2000 or length(coalesce(p_payload->>'replaced_parts',''))>1000 then raise exception 'Too long'; end if;
  update public.ticket_units set status=v_unit_status,maintenance_result=p_payload->>'maintenance_result',replaced_parts=p_payload->>'replaced_parts'
   where id=v_unit and ticket_id=p_ticket;
  if not found then raise exception 'Unit not found'; end if;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
   values(p_ticket,p_actor,'unit_updated',jsonb_build_object('unit_id',v_unit,'status',v_unit_status));

 elsif p_action='finish' then
  if v_role<>'leader' or v_leader is distinct from p_actor or v_status<>'in_progress' then raise exception 'Cannot finish'; end if;
  select id,started_at into v_session,v_started from public.ticket_work_sessions
   where ticket_id=p_ticket and leader_id=p_actor and ended_at is null for update;
  if not found then raise exception 'No active visit'; end if;
  v_ended:=clock_timestamp();
  update public.ticket_work_sessions set ended_at=v_ended where id=v_session;
  select count(*),count(*) filter(where status not in ('completed','replaced'))
   into v_count,v_pending from public.ticket_units where ticket_id=p_ticket;
  if v_count=0 then raise exception 'Ticket has no units'; end if;
  update public.tickets set status=case when v_pending=0 then 'completed'::public.ticket_status else 'pending_follow_up'::public.ticket_status end where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
   values(p_ticket,p_actor,'visit_finished',jsonb_build_object('session_id',v_session,'duration_seconds',greatest(0,extract(epoch from v_ended-v_started)::integer),'pending_units',v_pending));
  return jsonb_build_object('ok',true,'duration_seconds',greatest(0,extract(epoch from v_ended-v_started)::integer));

 elsif p_action='close' then
  if v_role<>'admin' or v_status<>'completed' then raise exception 'Cannot close'; end if;
  if exists(select 1 from public.ticket_work_sessions where ticket_id=p_ticket and ended_at is null) then raise exception 'Active visit'; end if;
  update public.tickets set status='closed',closed_at=clock_timestamp() where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type) values(p_ticket,p_actor,'closed');

 else raise exception 'Unknown action'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_ticket_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.staff_ticket_action(uuid,uuid,text,jsonb) to service_role;
