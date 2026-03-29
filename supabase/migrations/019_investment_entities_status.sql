alter table public.investment_entities
  add column if not exists is_closed boolean not null default false;