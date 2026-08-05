-- Meu Orçamento Inteligente — link compartilhável (só-leitura) de reembolsos por pessoa.
-- Execute em: Supabase Dashboard → SQL Editor → New query → Run
-- (precisa do schema.sql já rodado antes, com a tabela public.orcamentos criada).

-- Um token aleatório aponta para (dona da conta, pessoa). O token em si não deixa ver
-- nada: só serve de "chave" para a função get_reembolsos_publicos, que decide o que expor.
create table if not exists public.reembolso_links (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  pessoa_id text not null,
  criado_em timestamptz not null default now()
);

alter table public.reembolso_links enable row level security;

-- Só a dona autenticada gerencia os próprios links (criar, listar, apagar).
-- Não existe nenhuma policy de SELECT para "anon" nesta tabela — visitantes anônimos
-- nunca conseguem consultá-la diretamente, nem por token, nem por listagem.
drop policy if exists "links proprios - ler" on public.reembolso_links;
create policy "links proprios - ler"
  on public.reembolso_links for select
  using (auth.uid() = user_id);

drop policy if exists "links proprios - criar" on public.reembolso_links;
create policy "links proprios - criar"
  on public.reembolso_links for insert
  with check (auth.uid() = user_id);

drop policy if exists "links proprios - apagar" on public.reembolso_links;
create policy "links proprios - apagar"
  on public.reembolso_links for delete
  using (auth.uid() = user_id);

-- Função pública (SECURITY DEFINER): recebe só o token e devolve só o necessário —
-- nome da pessoa, itens pendentes dela e o total. Roda com privilégio elevado para
-- poder ler a linha de "orcamentos" da dona (que o RLS normal bloquearia para "anon"),
-- mas NUNCA devolve o jsonb bruto: filtra e resume tudo antes de responder. Nenhuma
-- outra pessoa, despesa ou dado do app é exposto por aqui.
create or replace function public.get_reembolsos_publicos(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_pessoa_id text;
  v_dados jsonb;
  v_pessoa_nome text;
  v_items jsonb;
  v_total numeric;
begin
  select user_id, pessoa_id into v_user_id, v_pessoa_id
  from public.reembolso_links where token = p_token;

  if v_user_id is null then
    return jsonb_build_object('erro', 'link invalido');
  end if;

  select dados into v_dados from public.orcamentos where user_id = v_user_id;
  if v_dados is null then
    return jsonb_build_object('erro', 'sem dados');
  end if;

  select p ->> 'nome' into v_pessoa_nome
  from jsonb_array_elements(coalesce(v_dados -> 'people', '[]'::jsonb)) p
  where p ->> 'id' = v_pessoa_id;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'descricao', r ->> 'descricao',
      'categoria', r ->> 'categoria',
      'mes', coalesce(r ->> 'mes', left(r ->> 'data', 7)),
      'valorAReembolsar', (r ->> 'valorAReembolsar')::numeric,
      'valorRecebido', coalesce((r ->> 'valorRecebido')::numeric, 0),
      'pendente', (r ->> 'valorAReembolsar')::numeric - coalesce((r ->> 'valorRecebido')::numeric, 0),
      'status', r ->> 'status'
    ) order by coalesce(r ->> 'mes', r ->> 'data')), '[]'::jsonb),
    coalesce(sum((r ->> 'valorAReembolsar')::numeric - coalesce((r ->> 'valorRecebido')::numeric, 0)), 0)
  into v_items, v_total
  from jsonb_array_elements(coalesce(v_dados -> 'reimbursements', '[]'::jsonb)) r
  where r ->> 'pessoaId' = v_pessoa_id
    and r ->> 'status' <> 'cancelado'
    and ((r ->> 'valorAReembolsar')::numeric - coalesce((r ->> 'valorRecebido')::numeric, 0)) > 0.004;

  return jsonb_build_object(
    'pessoa', coalesce(v_pessoa_nome, 'Pessoa'),
    'items', v_items,
    'totalPendente', v_total,
    'atualizadoEm', now()
  );
end;
$$;

-- Permite que qualquer visitante (sem login) chame a função — ela mesma decide o que
-- devolver com base no token, então não há risco em liberar a execução para "anon".
grant execute on function public.get_reembolsos_publicos(text) to anon;
