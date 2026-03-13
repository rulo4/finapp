update public.expense_entries
set subtotal_original = 0
where subtotal_original is null;

alter table public.expense_entries alter column subtotal_original set default 0;

alter table public.expense_entries drop constraint if exists expense_entries_subtotal_original_positive;
alter table public.expense_entries
  add constraint expense_entries_subtotal_original_non_negative check (subtotal_original >= 0);