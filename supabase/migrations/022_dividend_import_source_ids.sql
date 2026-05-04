alter table public.dividend_entries
  add column if not exists source_dividend_transaction_id text,
  add column if not exists source_tax_transaction_id text;

create unique index if not exists dividend_entries_user_source_dividend_tx_idx
  on public.dividend_entries(user_id, source_dividend_transaction_id)
  where source_dividend_transaction_id is not null;

create unique index if not exists dividend_entries_user_source_tax_tx_idx
  on public.dividend_entries(user_id, source_tax_transaction_id)
  where source_tax_transaction_id is not null;
