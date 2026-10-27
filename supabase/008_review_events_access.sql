-- V13: expose only review reasons to the authorized ticket reader.
-- Run after 007. Other audit events remain inaccessible to authenticated clients.
create policy review_events_read on public.ticket_events for select to authenticated
using (event_type = 'returned_for_revision' and
 (public.is_active_admin() or public.is_ticket_leader(ticket_id)));
