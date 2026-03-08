-- Finapp initial schema draft
-- This migration intentionally creates only the foundational tables needed to start wiring the app.

create extension if not exists pgcrypto;

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_instruments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  instrument_type text not null check (instrument_type in ('cash', 'debit_card', 'credit_card')),
  description text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.investment_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- User-owned business tables. Auth and RLS policies can be added in the next iteration.
create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  source_id uuid not null references public.income_sources(id),
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  amount_original numeric(18, 6) not null,
  fx_rate_to_mxn numeric(18, 6),
  amount_mxn numeric(18, 6),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  concept text not null,
  quantity numeric(18, 6) not null,
  unit_of_measure text not null,
  unit_cost_original numeric(18, 6),
  total_amount_original numeric(18, 6),
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  fx_rate_to_mxn numeric(18, 6),
  total_amount_mxn numeric(18, 6) not null,
  payment_instrument_id uuid references public.payment_instruments(id),
  store_id uuid references public.stores(id),
  ticket_url text,
  is_recurring boolean not null default false,
  category_id uuid not null references public.expense_categories(id),
  notes text,
  created_at timestamptz not null default now()
);

-- Additional portfolio tables will be expanded in later migrations.
