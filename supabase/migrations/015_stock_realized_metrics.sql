alter table public.stock_sells
  add column if not exists quantity_held_before_sell numeric(18, 6),
  add column if not exists average_cost_per_unit_mxn numeric(18, 6),
  add column if not exists average_cost_basis_mxn numeric(18, 6),
  add column if not exists fifo_cost_basis_mxn numeric(18, 6),
  add column if not exists average_realized_pnl_mxn numeric(18, 6),
  add column if not exists fifo_realized_pnl_mxn numeric(18, 6);

alter table public.stock_sells
  drop constraint if exists stock_sells_quantity_held_before_sell_nonnegative,
  drop constraint if exists stock_sells_average_cost_per_unit_mxn_nonnegative,
  drop constraint if exists stock_sells_average_cost_basis_mxn_nonnegative,
  drop constraint if exists stock_sells_fifo_cost_basis_mxn_nonnegative;

alter table public.stock_sells
  add constraint stock_sells_quantity_held_before_sell_nonnegative
    check (quantity_held_before_sell is null or quantity_held_before_sell >= 0),
  add constraint stock_sells_average_cost_per_unit_mxn_nonnegative
    check (average_cost_per_unit_mxn is null or average_cost_per_unit_mxn >= 0),
  add constraint stock_sells_average_cost_basis_mxn_nonnegative
    check (average_cost_basis_mxn is null or average_cost_basis_mxn >= 0),
  add constraint stock_sells_fifo_cost_basis_mxn_nonnegative
    check (fifo_cost_basis_mxn is null or fifo_cost_basis_mxn >= 0);