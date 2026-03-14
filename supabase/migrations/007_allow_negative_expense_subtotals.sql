alter table public.expense_entries
  drop constraint if exists expense_entries_subtotal_original_non_negative;

alter table public.expense_entries
  drop constraint if exists expense_entries_subtotal_original_positive;

comment on column public.expense_entries.subtotal_original is 'Primary original-currency subtotal captured from the receipt or expense summary. Can be negative for discounts, rebates, or adjustments.';