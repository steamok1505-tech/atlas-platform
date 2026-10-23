-- Store which clearly-labelled demo contact a website visitor selected.
-- This is metadata only; all replies remain under the Atlas Support identity.
alter table public.messages
  add column if not exists contact_label text;

comment on column public.messages.contact_label is
  'Optional UI context for a clearly-labelled synthetic demo contact; not a real-person identity.';
