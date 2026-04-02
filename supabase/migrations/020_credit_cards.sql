create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  payment_instrument_id uuid not null unique references public.payment_instruments(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  statement_day smallint not null,
  grace_days smallint not null default 20,
  pre_cutoff_spend_target_mxn numeric(18, 6) not null default 0,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_cards_statement_day_range check (statement_day between 1 and 31),
  constraint credit_cards_grace_days_range check (grace_days between 1 and 60),
  constraint credit_cards_pre_cutoff_spend_target_non_negative check (pre_cutoff_spend_target_mxn >= 0)
);

create index if not exists credit_cards_user_id_idx on public.credit_cards(user_id);
create index if not exists credit_cards_is_active_idx on public.credit_cards(user_id, is_active);

grant select, insert, update, delete on public.credit_cards to authenticated;

alter table public.credit_cards enable row level security;

drop policy if exists credit_cards_select_own on public.credit_cards;
drop policy if exists credit_cards_insert_own on public.credit_cards;
drop policy if exists credit_cards_update_own on public.credit_cards;
drop policy if exists credit_cards_delete_own on public.credit_cards;

create policy credit_cards_select_own on public.credit_cards for select to authenticated using (user_id = auth.uid());
create policy credit_cards_insert_own on public.credit_cards for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.payment_instruments
    where payment_instruments.id = credit_cards.payment_instrument_id
      and payment_instruments.user_id = auth.uid()
      and payment_instruments.instrument_type = 'credit_card'
  )
);
create policy credit_cards_update_own on public.credit_cards for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.payment_instruments
    where payment_instruments.id = credit_cards.payment_instrument_id
      and payment_instruments.user_id = auth.uid()
      and payment_instruments.instrument_type = 'credit_card'
  )
);
create policy credit_cards_delete_own on public.credit_cards for delete to authenticated using (user_id = auth.uid());

drop trigger if exists credit_cards_set_updated_at on public.credit_cards;
create trigger credit_cards_set_updated_at
before update on public.credit_cards
for each row
execute function public.set_updated_at_timestamp();

create table if not exists public.credit_card_payments (
  id uuid primary key default gen_random_uuid(),
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payment_date date not null,
  amount_mxn numeric(18, 6) not null default 0,
  bonus_statement_credit_mxn numeric(18, 6) not null default 0,
  bonus_reward_points numeric(18, 6) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_payments_amount_non_negative check (amount_mxn >= 0),
  constraint credit_card_payments_bonus_statement_credit_non_negative check (bonus_statement_credit_mxn >= 0),
  constraint credit_card_payments_bonus_reward_points_non_negative check (bonus_reward_points >= 0),
  constraint credit_card_payments_non_empty check (
    amount_mxn > 0
    or bonus_statement_credit_mxn > 0
    or bonus_reward_points > 0
  )
);

create index if not exists credit_card_payments_credit_card_date_idx on public.credit_card_payments(credit_card_id, payment_date desc);
create index if not exists credit_card_payments_user_id_idx on public.credit_card_payments(user_id);

grant select, insert, update, delete on public.credit_card_payments to authenticated;

alter table public.credit_card_payments enable row level security;

drop policy if exists credit_card_payments_select_own on public.credit_card_payments;
drop policy if exists credit_card_payments_insert_own on public.credit_card_payments;
drop policy if exists credit_card_payments_update_own on public.credit_card_payments;
drop policy if exists credit_card_payments_delete_own on public.credit_card_payments;

create policy credit_card_payments_select_own on public.credit_card_payments for select to authenticated using (user_id = auth.uid());
create policy credit_card_payments_insert_own on public.credit_card_payments for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.credit_cards
    where credit_cards.id = credit_card_payments.credit_card_id
      and credit_cards.user_id = auth.uid()
  )
);
create policy credit_card_payments_update_own on public.credit_card_payments for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.credit_cards
    where credit_cards.id = credit_card_payments.credit_card_id
      and credit_cards.user_id = auth.uid()
  )
);
create policy credit_card_payments_delete_own on public.credit_card_payments for delete to authenticated using (user_id = auth.uid());

drop trigger if exists credit_card_payments_set_updated_at on public.credit_card_payments;
create trigger credit_card_payments_set_updated_at
before update on public.credit_card_payments
for each row
execute function public.set_updated_at_timestamp();

create table if not exists public.credit_card_statement_reconciliations (
  id uuid primary key default gen_random_uuid(),
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  statement_date date not null,
  adjusted_closing_balance_mxn numeric(18, 6) not null,
  adjustment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists credit_card_statement_reconciliations_card_date_idx
  on public.credit_card_statement_reconciliations(credit_card_id, statement_date);
create index if not exists credit_card_statement_reconciliations_user_id_idx
  on public.credit_card_statement_reconciliations(user_id);

grant select, insert, update, delete on public.credit_card_statement_reconciliations to authenticated;

alter table public.credit_card_statement_reconciliations enable row level security;

drop policy if exists credit_card_statement_reconciliations_select_own on public.credit_card_statement_reconciliations;
drop policy if exists credit_card_statement_reconciliations_insert_own on public.credit_card_statement_reconciliations;
drop policy if exists credit_card_statement_reconciliations_update_own on public.credit_card_statement_reconciliations;
drop policy if exists credit_card_statement_reconciliations_delete_own on public.credit_card_statement_reconciliations;

create policy credit_card_statement_reconciliations_select_own on public.credit_card_statement_reconciliations for select to authenticated using (user_id = auth.uid());
create policy credit_card_statement_reconciliations_insert_own on public.credit_card_statement_reconciliations for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.credit_cards
    where credit_cards.id = credit_card_statement_reconciliations.credit_card_id
      and credit_cards.user_id = auth.uid()
  )
);
create policy credit_card_statement_reconciliations_update_own on public.credit_card_statement_reconciliations for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.credit_cards
    where credit_cards.id = credit_card_statement_reconciliations.credit_card_id
      and credit_cards.user_id = auth.uid()
  )
);
create policy credit_card_statement_reconciliations_delete_own on public.credit_card_statement_reconciliations for delete to authenticated using (user_id = auth.uid());

drop trigger if exists credit_card_statement_reconciliations_set_updated_at on public.credit_card_statement_reconciliations;
create trigger credit_card_statement_reconciliations_set_updated_at
before update on public.credit_card_statement_reconciliations
for each row
execute function public.set_updated_at_timestamp();