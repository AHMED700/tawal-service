-- Enforce AC number format and uniqueness within a ticket, including 1 vs 001.
-- Existing records must be cleaned before applying if they violate these constraints.
alter table public.ticket_units add constraint ac_number_english_3_digits check (ac_number ~ '^[0-9]{1,3}$');
create unique index ticket_units_unique_normalized_ac_number on public.ticket_units(ticket_id, ((ac_number)::integer));
