-- Apply after 008, only with database-owner approval.
-- Require an explicit result or follow-up reason for every AC before ending a visit.
create or replace function public.staff_ticket_action(p_actor uuid,p_ticket uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_role text; v_status public.ticket_status; v_leader uuid; v_unit uuid;
 v_unit_status public.unit_status; v_pending integer; v_count integer;
 v_session uuid; v_started timestamptz; v_ended timestamptz;
 v_parts jsonb; v_part jsonb; v_reason text; v_kind text;
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
  if v_role<>'leader' or v_leader is distinct from p_actor or v_status not in ('assigned','pending_follow_up','revision_required') then raise exception 'Cannot start'; end if;
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
  v_reason:=nullif(btrim(coalesce(p_payload->>'follow_up_reason','')),'');
  if v_unit_status='pending_follow_up' and (v_reason is null or v_reason not in ('parts','workshop','approval','return_visit','other')) then raise exception 'Follow-up reason required'; end if;
  if v_unit_status<>'pending_follow_up' then v_reason:=null; end if;
  v_parts:=coalesce(p_payload->'parts','[]'::jsonb);
  if jsonb_typeof(v_parts)<>'array' or jsonb_array_length(v_parts)>20 then raise exception 'Invalid parts'; end if;
  for v_part in select value from jsonb_array_elements(v_parts) loop
   if coalesce(v_part->>'code','') not in ('capacitor','fan_capacitor','pcb','refrigerant','outdoor_motor','indoor_motor','cross_flow','filter_cleaning','ac_switch','other') then raise exception 'Invalid part'; end if;
   if coalesce(v_part->>'usage','') not in ('used','required') then raise exception 'Invalid usage'; end if;
   if coalesce(v_part->>'quantity','') !~ '^[0-9]{1,3}$' or (v_part->>'quantity')::int not between 1 and 999 then raise exception 'Invalid quantity'; end if;
   if length(coalesce(v_part->>'name',''))>120 then raise exception 'Invalid name'; end if;
   if v_part->>'code'='other' and nullif(btrim(v_part->>'name'),'') is null then raise exception 'Other name required'; end if;
  end loop;
  if v_unit_status in ('completed','replaced') and exists(select 1 from jsonb_array_elements(v_parts) p where p->>'usage'='required') then raise exception 'Required parts need follow-up'; end if;
  if length(coalesce(p_payload->>'maintenance_result',''))>2000 or length(coalesce(p_payload->>'replaced_parts',''))>1000 then raise exception 'Too long'; end if;
  update public.ticket_units set status=v_unit_status,maintenance_result=p_payload->>'maintenance_result',replaced_parts=p_payload->>'replaced_parts',follow_up_reason=v_reason,parts=v_parts
   where id=v_unit and ticket_id=p_ticket;
  if not found then raise exception 'Unit not found'; end if;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
   values(p_ticket,p_actor,'unit_updated',jsonb_build_object('unit_id',v_unit,'status',v_unit_status));

 elsif p_action='finish' then
  if v_role<>'leader' or v_leader is distinct from p_actor or v_status<>'in_progress' then raise exception 'Cannot finish'; end if;
  select id,started_at into v_session,v_started from public.ticket_work_sessions
   where ticket_id=p_ticket and leader_id=p_actor and ended_at is null for update;
  if not found then raise exception 'No active visit'; end if;
  if exists(select 1 from public.ticket_units where ticket_id=p_ticket and
   (status in ('pending','in_progress') or
    (status='pending_follow_up' and nullif(btrim(follow_up_reason),'') is null)))
  then raise exception 'Record all unit outcomes before finishing'; end if;
  v_ended:=clock_timestamp();
  update public.ticket_work_sessions set ended_at=v_ended where id=v_session;
  select count(*),count(*) filter(where status not in ('completed','replaced'))
   into v_count,v_pending from public.ticket_units where ticket_id=p_ticket;
  if v_count=0 then raise exception 'Ticket has no units'; end if;
  update public.tickets set status=case when v_pending=0 then 'completed'::public.ticket_status else 'pending_follow_up'::public.ticket_status end where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
   values(p_ticket,p_actor,'visit_finished',jsonb_build_object('session_id',v_session,'duration_seconds',greatest(0,extract(epoch from v_ended-v_started)::integer),'pending_units',v_pending));
  return jsonb_build_object('ok',true,'duration_seconds',greatest(0,extract(epoch from v_ended-v_started)::integer));

 elsif p_action='return_for_revision' then
  if v_role<>'admin' or v_status<>'completed' then raise exception 'Cannot return for revision'; end if;
  v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
  if v_reason is null or length(v_reason)<5 or length(v_reason)>1000 then raise exception 'Return reason required'; end if;
  if exists(select 1 from public.ticket_work_sessions where ticket_id=p_ticket and ended_at is null) then raise exception 'Active visit'; end if;
  update public.tickets set status='revision_required' where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details)
  values(p_ticket,p_actor,'returned_for_revision',jsonb_build_object('reason',v_reason));

 elsif p_action='close' then
  if v_role<>'admin' or v_status<>'completed' then raise exception 'Cannot close'; end if;
  if exists(select 1 from public.ticket_work_sessions where ticket_id=p_ticket and ended_at is null) then raise exception 'Active visit'; end if;
  if exists(select 1 from public.ticket_units where ticket_id=p_ticket and (status not in ('completed','replaced') or nullif(btrim(coalesce(maintenance_result,'')),'') is null)) then raise exception 'Unfinished unit'; end if;
  update public.tickets set status='closed',closed_at=clock_timestamp() where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type) values(p_ticket,p_actor,'closed');

 else raise exception 'Unknown action'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_ticket_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.staff_ticket_action(uuid,uuid,text,jsonb) to service_role;
