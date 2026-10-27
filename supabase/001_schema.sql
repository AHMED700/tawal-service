-- Run in Supabase SQL editor. Keep service-role credentials on server only.
create extension if not exists pgcrypto;
create type public.ticket_status as enum ('submitted','assigned','in_progress','pending_follow_up','completed','closed');
create type public.unit_status as enum ('pending','in_progress','pending_follow_up','completed','replaced');
create table public.staff_profiles(user_id uuid primary key references auth.users(id) on delete cascade,display_name text not null,role text not null check(role in ('admin','leader')),active boolean not null default true);
create table public.tickets(id uuid primary key default gen_random_uuid(),ticket_number bigint generated always as identity unique,school_name text not null,school_code text,city text not null,contact_name text,contact_phone text not null,contact_email text,school_notes text,status public.ticket_status not null default 'submitted',assigned_leader_id uuid references public.staff_profiles(user_id),created_at timestamptz not null default now(),closed_at timestamptz);
create table public.ticket_units(id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.tickets(id) on delete cascade,item_number smallint not null check(item_number between 1 and 10),ac_number text not null,problem_type text not null,ac_location text not null,school_notes text,status public.unit_status not null default 'pending',maintenance_result text,replaced_parts text,unique(ticket_id,item_number));
create table public.ticket_events(id bigint generated always as identity primary key,ticket_id uuid not null references public.tickets(id) on delete cascade,actor_id uuid references public.staff_profiles(user_id),event_type text not null,details jsonb not null default '{}'::jsonb,occurred_at timestamptz not null default now());
create index on public.tickets(assigned_leader_id,created_at desc);
create index on public.ticket_units(ticket_id);
alter table public.staff_profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_units enable row level security;
alter table public.ticket_events enable row level security;
-- Only server-side service role can call this RPC; no anonymous grants.
create or replace function public.create_school_ticket(payload jsonb) returns bigint language plpgsql security definer set search_path = '' as $$
declare new_id uuid; new_number bigint; unit jsonb; i integer:=0; count_units integer;
begin
 count_units:=jsonb_array_length(payload->'units');
 if count_units < 1 or count_units > 10 then raise exception 'Invalid unit count'; end if;
 insert into public.tickets(school_name,school_code,city,contact_name,contact_phone,contact_email,school_notes)
 values(payload->>'school_name',payload->>'school_code',payload->>'city',payload->>'contact_name',payload->>'contact_phone',payload->>'contact_email',payload->>'school_notes') returning id,ticket_number into new_id,new_number;
 for unit in select value from jsonb_array_elements(payload->'units') loop
 i:=i+1;
 insert into public.ticket_units(ticket_id,item_number,ac_number,problem_type,ac_location,school_notes) values(new_id,i,unit->>'ac_number',unit->>'problem_type',unit->>'ac_location',unit->>'school_notes');
 end loop;
 insert into public.ticket_events(ticket_id,event_type,details) values(new_id,'school_submitted',jsonb_build_object('unit_count',count_units));
 return new_number;
end $$;
revoke all on function public.create_school_ticket(jsonb) from public,anon,authenticated;
grant execute on function public.create_school_ticket(jsonb) to service_role;
