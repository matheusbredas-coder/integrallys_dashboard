-- Track which pitch image URLs a lead has already been sent, so a given
-- before/after photo is never repeated within a conversation.
alter table public.bot_leads
  add column if not exists sent_image_urls text[] not null default '{}';
