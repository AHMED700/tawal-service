-- Staff operations: run AFTER 001_schema.sql. Security-definer RPC is service-role only.
-- All operations run in one transaction; the caller's identity is verified in the API.
create or replace function public.staff_ticket_action(p_actor uuid,p_ticket uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_status public.ticket_status; v_leader uuid; v_unit uuid; v_unit_status public.unit_status; v_pending integer; v_count integer;
begin
 select role into v_role from public.staff_profiles where user_id=p_actor and active=true;
 if v_role is null then raise exception 'Not authorized'; end if;
 select status,assigned_leader_id into v_status,v_leader from public.tickets where id=p_ticket for update;
 if not found then raise exception 'Ticket not found'; end if;
 if p_action='assign' then
  if v_role<>'admin' or v_status='closed' then raise exception 'Cannot assign'; end if;
  v_leader:=(p_payload->>'leader_id')::uuid;
  if not exists(select 1 from public.staff_profiles where user_id=v_leader and role='leader' and active=true) then raise exception 'Invalid leader'; end if;
  update public.tickets set assigned_leader_id=v_leader,status='assigned' where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details) values(p_ticket,p_actor,'assigned',jsonb_build_object('leader_id',v_leader));
 elsif p_action='unit' then
  if v_role<>'leader' or v_leader is distinct from p_actor or v_status='closed' then raise exception 'Cannot update unit'; end if;
  v_unit:=(p_payload->>'unit_id')::uuid;
  v_unit_status:=(p_payload->>'status')::public.unit_status;
  if length(coalesce(p_payload->>'maintenance_result',''))>2000 or length(coalesce(p_payload->>'replaced_parts',''))>1000 then raise exception 'Too long'; end if;
  update public.ticket_units set status=v_unit_status,maintenance_result=p_payload->>'maintenance_result',replaced_parts=p_payload->>'replaced_parts'
  where id=v_unit and ticket_id=p_ticket;
  if not found then raise exception 'Unit not found'; end if;
  select count(*),count(*) filter(where status not in ('completed','replaced')) into v_count,v_pending from public.ticket_units where ticket_id=p_ticket;
  update public.tickets set status=case when v_pending=0 then 'completed'::public.ticket_status
    when exists(select 1 from public.ticket_units where ticket_id=p_ticket and status='pending_follow_up') then 'pending_follow_up'::public.ticket_status
    else 'in_progress'::public.ticket_status end where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type,details) values(p_ticket,p_actor,'unit_updated',jsonb_build_object('unit_id',v_unit,'status',v_unit_status));
 elsif p_action='close' then
  if v_role<>'admin' or v_status<>'completed' then raise exception 'Cannot close'; end if;
  update public.tickets set status='closed',closed_at=now() where id=p_ticket;
  insert into public.ticket_events(ticket_id,actor_id,event_type) values(p_ticket,p_actor,'closed');
 else raise exception 'Unknown action'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_ticket_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.staff_ticket_action(uuid,uuid,text,jsonb) to service_role;
