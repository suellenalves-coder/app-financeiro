-- Meu Orçamento Inteligente — banco de dados no Supabase
-- Execute este script uma única vez em: Supabase Dashboard → SQL Editor → New query → Run

-- Uma linha por usuária, com todos os dados do app em JSON.
create table if not exists public.orcamentos (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- Segurança: cada usuária enxerga e altera apenas a própria linha.
alter table public.orcamentos enable row level security;

drop policy if exists "orcamento proprio - ler" on public.orcamentos;
create policy "orcamento proprio - ler"
  on public.orcamentos for select
  using (auth.uid() = user_id);

drop policy if exists "orcamento proprio - criar" on public.orcamentos;
create policy "orcamento proprio - criar"
  on public.orcamentos for insert
  with check (auth.uid() = user_id);

drop policy if exists "orcamento proprio - atualizar" on public.orcamentos;
create policy "orcamento proprio - atualizar"
  on public.orcamentos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
