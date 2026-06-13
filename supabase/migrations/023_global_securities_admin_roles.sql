create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now()
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists user_roles_select_own on public.user_roles;

create policy user_roles_select_own
on public.user_roles
for select
to authenticated
using (user_id = auth.uid());

insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where id = '1cc50512-d724-426c-9ec1-5b666bf50f79'
on conflict (user_id) do update
set role = excluded.role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_roles.user_id = auth.uid()
      and user_roles.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

update public.securities
set ticker = upper(btrim(ticker)),
    exchange_code = nullif(upper(btrim(coalesce(exchange_code, ''))), '');

do $$
begin
  if exists (
    select 1
    from public.securities
    where exchange_code is null
  ) then
    raise exception 'Todas las securities deben tener exchange_code antes de la migracion global.';
  end if;

  if exists (
    select 1
    from public.securities
    group by upper(btrim(ticker))
    having count(*) > 1
  ) then
    raise exception 'Existen tickers duplicados en securities. Deben eliminarse antes de la migracion global.';
  end if;
end;
$$;

drop policy if exists securities_select_own on public.securities;
drop policy if exists securities_insert_own on public.securities;
drop policy if exists securities_update_own on public.securities;
drop policy if exists securities_delete_own on public.securities;
drop policy if exists securities_select_all on public.securities;
drop policy if exists securities_insert_authenticated on public.securities;
drop policy if exists securities_update_admin on public.securities;
drop policy if exists securities_delete_admin on public.securities;

drop policy if exists stock_buys_insert_own on public.stock_buys;
drop policy if exists stock_buys_update_own on public.stock_buys;
drop policy if exists stock_sells_insert_own on public.stock_sells;
drop policy if exists stock_sells_update_own on public.stock_sells;
drop policy if exists dividend_entries_insert_own on public.dividend_entries;
drop policy if exists dividend_entries_update_own on public.dividend_entries;

drop index if exists public.securities_user_id_idx;
drop index if exists public.securities_ticker_idx;
drop index if exists public.securities_sector_idx;
drop index if exists public.securities_industry_idx;
drop index if exists public.securities_user_id_exchange_ticker_idx;
drop index if exists public.securities_ticker_unique_idx;

alter table public.securities
  drop column if exists user_id,
  drop column if exists currency_code;

alter table public.securities
  alter column exchange_code set not null;

create unique index if not exists securities_ticker_unique_idx
  on public.securities(upper(btrim(ticker)));

create index if not exists securities_sector_idx
  on public.securities(sector);

create index if not exists securities_industry_idx
  on public.securities(industry);

create policy securities_select_all
on public.securities
for select
to authenticated
using (true);

create policy securities_insert_authenticated
on public.securities
for insert
to authenticated
with check (true);

create policy securities_update_admin
on public.securities
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy securities_delete_admin
on public.securities
for delete
to authenticated
using (public.is_admin());

create policy stock_buys_insert_own on public.stock_buys for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_buys.security_id
  )
);

create policy stock_buys_update_own on public.stock_buys for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_buys.security_id
  )
);

create policy stock_sells_insert_own on public.stock_sells for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_sells.security_id
  )
);

create policy stock_sells_update_own on public.stock_sells for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_sells.security_id
  )
);

create policy dividend_entries_insert_own on public.dividend_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = dividend_entries.security_id
  )
);

create policy dividend_entries_update_own on public.dividend_entries for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = dividend_entries.security_id
  )
);
