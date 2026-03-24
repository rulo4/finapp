alter table public.stock_sells
  add column if not exists sell_group_id uuid not null default gen_random_uuid(),
  add column if not exists stock_buy_id uuid references public.stock_buys(id) on delete restrict;

create index if not exists stock_sells_sell_group_idx on public.stock_sells(sell_group_id);
create index if not exists stock_sells_stock_buy_idx on public.stock_sells(stock_buy_id);

alter table public.stock_sells
  drop constraint if exists stock_sells_average_cost_per_unit_mxn_nonnegative,
  drop constraint if exists stock_sells_average_cost_basis_mxn_nonnegative,
  drop column if exists average_cost_per_unit_mxn,
  drop column if exists average_cost_basis_mxn,
  drop column if exists average_realized_pnl_mxn;