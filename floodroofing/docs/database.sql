-- Run this in your Supabase SQL editor (supabase.com → your project → SQL Editor)

-- User profiles
create table profiles (
  id uuid references auth.users primary key,
  email text not null,
  name text default '',
  company text default '',
  created_at timestamptz default now()
);

-- Subscriptions
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  status text not null default 'trialing',
  plan text default 'monthly',
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Jobs (saved estimates)
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  client_name text default '',
  site_address text default '',
  status text default 'draft',
  draw_state jsonb default '{}',
  settings jsonb default '{}',
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security: users can only see their own data
alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table jobs enable row level security;

create policy "Users see own profile" on profiles for all using (auth.uid() = id);
create policy "Users see own subscription" on subscriptions for all using (auth.uid() = user_id);
create policy "Users see own jobs" on jobs for all using (auth.uid() = user_id);

-- Index for fast job lookups
create index jobs_user_id_idx on jobs(user_id);
create index jobs_updated_at_idx on jobs(updated_at desc);

-- Per-user app settings (branding, quote defaults, JMS API keys)
create table user_settings (
  user_id uuid references auth.users primary key,
  branding jsonb default '{}',     -- {company_name, tagline, address, email, phone, website, logo_data_url, primary_color, accent_color, dark_color}
  quote_defaults jsonb default '{}', -- {validity_days, terms, options:[{label,enabled}], sections:[{title,body}]}
  jms_keys jsonb default '{}',     -- {fergus, servicem8, jobber, tradify}
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;
create policy "Users see own settings" on user_settings for all using (auth.uid() = user_id);
