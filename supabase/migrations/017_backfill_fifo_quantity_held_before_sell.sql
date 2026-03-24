with ordered_group_rows as (
  select
    sells.id,
    sells.sell_group_id,
    sells.quantity,
    sum(sells.quantity) over (
      partition by sells.sell_group_id
      order by buys.trade_date, buys.created_at, buys.id, sells.id
      rows between unbounded preceding and 1 preceding
    ) as prior_quantity_in_group,
    sum(sells.quantity) over (partition by sells.sell_group_id) as total_group_quantity
  from public.stock_sells as sells
  join public.stock_buys as buys
    on buys.id = sells.stock_buy_id
  where sells.sell_group_id is not null
    and sells.stock_buy_id is not null
),
recomputed as (
  select
    id,
    total_group_quantity - coalesce(prior_quantity_in_group, 0) as quantity_held_before_sell
  from ordered_group_rows
)
update public.stock_sells as sells
set quantity_held_before_sell = recomputed.quantity_held_before_sell
from recomputed
where sells.id = recomputed.id;