-- Kasa Defteri - Supabase şeması
-- Supabase projenin SQL Editor'ünde bu dosyanın tamamını tek seferde çalıştır.

create table if not exists kasa_settings (
  id int primary key default 1,
  company_name text not null,
  user1 text not null,
  pin1 text not null default '1234',
  user2 text not null,
  pin2 text not null default '5678',
  pin text,
  updated_at timestamptz not null default now(),
  constraint kasa_settings_singleton check (id = 1)
);

create table if not exists kasa_projects (
  id text primary key,
  name text not null,
  is_general boolean not null default false,
  sort_order integer,
  created_at timestamptz not null default now()
);

alter table kasa_projects add column if not exists sort_order integer;

update kasa_projects
set sort_order = (extract(epoch from created_at))::bigint
where sort_order is null;

create unique index if not exists kasa_projects_name_lower_idx on kasa_projects (lower(name));

create table if not exists kasa_transactions (
  id text primary key,
  project_id text not null references kasa_projects(id) on delete cascade,
  type text not null check (type in ('gelir','gider')),
  amount numeric not null,
  category text,
  description text,
  bank text,
  txn_date date not null,
  added_by text,
  created_at timestamptz not null default now()
);

alter table kasa_transactions add column if not exists bank text;
alter table kasa_transactions add column if not exists party text;

create table if not exists kasa_banks (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into kasa_banks (id, name)
values ('__nakit__', 'Nakit'), ('__kuveyt__', 'Kuveyt'), ('__akbank__', 'Akbank'), ('__enpara__', 'En Para'), ('__cepten__', 'Cepten')
on conflict (name) do nothing;

create table if not exists kasa_debts (
  id text primary key,
  project_id text not null references kasa_projects(id) on delete cascade,
  type text not null check (type in ('alinan','verilen')),
  amount numeric not null,
  currency text not null default 'TRY',
  party text,
  description text,
  debt_date date not null,
  paid boolean not null default false,
  added_by text,
  rate_snapshot numeric,
  principal_amount numeric,
  created_at timestamptz not null default now()
);

alter table kasa_debts add column if not exists rate_snapshot numeric;
alter table kasa_debts add column if not exists principal_amount numeric;

create table if not exists kasa_debt_payments (
  id text primary key,
  debt_id text not null references kasa_debts(id) on delete cascade,
  amount numeric not null,
  description text,
  payment_date date not null,
  added_by text,
  created_at timestamptz not null default now()
);

alter table kasa_debt_payments add column if not exists description text;

create table if not exists kasa_debt_installments (
  id text primary key,
  debt_id text not null references kasa_debts(id) on delete cascade,
  installment_no int not null,
  due_date date not null,
  amount numeric not null,
  paid boolean not null default false,
  paid_date date,
  paid_by text,
  created_at timestamptz not null default now()
);

create table if not exists kasa_rates (
  id int primary key default 1,
  usd numeric,
  eur numeric,
  gram_altin numeric,
  ceyrek_altin numeric,
  tam_altin numeric,
  cumhuriyet_altini numeric,
  ata_altin numeric,
  ayar_bilezik numeric,
  fetched_at timestamptz,
  fetched_date_str text,
  constraint kasa_rates_singleton check (id = 1)
);

-- Sabit "Genel Şirket Giderleri" projesini önceden oluştur (silinemez, uygulama bunu korur)
insert into kasa_projects (id, name, is_general)
values ('__genel__', 'Genel Şirket Giderleri', true)
on conflict (id) do nothing;

-- ÖNEMLİ GÜVENLİK NOTU:
-- Bu uygulama Supabase Auth (gerçek kullanıcı oturumu) KULLANMIYOR — sadece uygulama
-- içi isim + PIN kontrolü var. Bu yüzden aşağıdaki politikalar "anon" anahtarıyla
-- gelen herkese okuma/yazma izni verir (linki + anon key'i bilen biri PIN ekranını
-- atlayıp veriye API üzerinden de erişebilir). Bu, artifact sürümüyle aynı güvenlik
-- seviyesidir. Daha güçlü bir güvenlik istersen ileride Supabase Auth eklenip bu
-- politikalar "authenticated" rolüne göre daraltılabilir.

alter table kasa_settings enable row level security;
alter table kasa_projects enable row level security;
alter table kasa_transactions enable row level security;
alter table kasa_debts enable row level security;
alter table kasa_debt_payments enable row level security;
alter table kasa_debt_installments enable row level security;
alter table kasa_banks enable row level security;
alter table kasa_rates enable row level security;

drop policy if exists "allow all kasa_settings" on kasa_settings;
create policy "allow all kasa_settings" on kasa_settings for all using (true) with check (true);

drop policy if exists "allow all kasa_projects" on kasa_projects;
create policy "allow all kasa_projects" on kasa_projects for all using (true) with check (true);

drop policy if exists "allow all kasa_transactions" on kasa_transactions;
create policy "allow all kasa_transactions" on kasa_transactions for all using (true) with check (true);

drop policy if exists "allow all kasa_debts" on kasa_debts;
create policy "allow all kasa_debts" on kasa_debts for all using (true) with check (true);

drop policy if exists "allow all kasa_debt_payments" on kasa_debt_payments;
create policy "allow all kasa_debt_payments" on kasa_debt_payments for all using (true) with check (true);

drop policy if exists "allow all kasa_debt_installments" on kasa_debt_installments;
create policy "allow all kasa_debt_installments" on kasa_debt_installments for all using (true) with check (true);

drop policy if exists "allow all kasa_banks" on kasa_banks;
create policy "allow all kasa_banks" on kasa_banks for all using (true) with check (true);

drop policy if exists "allow all kasa_rates" on kasa_rates;
create policy "allow all kasa_rates" on kasa_rates for all using (true) with check (true);

