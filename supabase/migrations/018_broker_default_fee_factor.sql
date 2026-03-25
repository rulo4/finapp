alter table public.brokers
  add column if not exists default_fee_factor numeric(18, 6) not null default 0;

alter table public.brokers
  drop constraint if exists brokers_default_fee_factor_nonnegative;

alter table public.brokers
  add constraint brokers_default_fee_factor_nonnegative
    check (default_fee_factor >= 0);
