# 🌿 Meu Orçamento Inteligente

Aplicativo web responsivo de gestão de orçamento mensal e anual pessoal, com foco em
**renda comprometida**, **previsibilidade financeira**, **parcelamentos**, **contas
recorrentes**, **investimentos**, **provisões** e **reembolsos**.

Mais do que controlar gastos, o app mostra **quanto da renda já está comprometida,
quanto ainda está livre de verdade** e qual será o impacto das decisões de hoje nos
meses futuros.

## Como executar

O app é 100% estático — não precisa de build, backend nem instalação de dependências.

```bash
# qualquer servidor estático serve, por exemplo:
python3 -m http.server 8080
# e abra http://localhost:8080
```

Também funciona hospedado no GitHub Pages, Netlify, Vercel etc.
Os dados ficam salvos no navegador (`localStorage`); use **Configurações → Dados**
para exportar/restaurar backup em JSON.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Dashboard mensal** | Cards de receitas, despesas, parcelas, provisões, investimentos, reembolsos, saldo previsto, **saldo livre real** e % de renda comprometida, com alertas automáticos (70% / 85% / saldo negativo / contas vencidas). |
| **Visão anual** | Acumulados realizados + projetados, tabela mês a mês, evolução de receitas/despesas/investimentos e parcelas futuras. |
| **Receitas** | Categorias e tipos (segura, variável, extraordinária), status, recorrência mensal automática. |
| **Despesas** | Cadastro completo, natureza fixa/variável, classificação estratégica, pagamento em um clique, duplicar, filtros, despesa **reembolsável** com valor líquido real. |
| **Cartões e parcelas** | Faturas por cartão (novas × herdadas), limite planejado com medidor, compra parcelada com **geração automática de todas as parcelas futuras**, mapa de parcelamentos e **importação em massa** (CSV / colagem de planilha). |
| **Contas recorrentes** | Periodicidades (mensal a anual), ocorrências geradas automaticamente, edição de um mês sem alterar a regra. |
| **Provisões** | Valor alvo + data alvo → cálculo automático do valor mensal; o valor sugerido impacta o saldo livre real. |
| **Investimentos** | Carteira por banco/produto/tipo/objetivo, aportes planejado × realizado, meta de reserva mínima com alerta. |
| **Reembolsos** | Resumo por pessoa, recebimento parcial, histórico e **mensagem pronta para WhatsApp** (resumida ou detalhada, com botão copiar). |
| **Calendário financeiro** | Tudo do mês dia a dia, com cores/ícones por tipo e alertas de vencimento (3 dias, hoje, vencido). |
| **Fechamento mensal** | Checklist guiado, indicadores planejado × realizado e **diagnóstico automático em texto**. |
| **Simulador de compra** | Impacto de uma nova compra parcelada mês a mês antes de confirmar (saldo, fatura, comprometimento). |
| **Módulo do carro** | Custo mensal/anual consolidado (avulsas + recorrentes + parcelas + provisões do carro). |
| **Relatórios** | DRE pessoal, despesas, categorias, parcelamentos, reembolsos, investimentos, provisões e recorrentes — todos com **exportação CSV**. |
| **Configurações** | Metas, categorias/subcategorias, bancos, cartões, pessoas, **regras automáticas de categorização** e backup. |

## Conceitos de cálculo

- **Receita segura** — soma das receitas classificadas como seguras.
- **Despesa líquida real** — despesa bruta menos a parte reembolsável (reembolso não é receita livre: abate a despesa original).
- **Saldo livre real** — receita segura − (fixas + recorrentes + parcelas + provisões + aportes planejados + variáveis já cadastradas).
- **Comprometimento da renda** — compromissos do mês ÷ receita segura (alerta amarelo > 70%, vermelho > 85%).

## Importação em massa de parcelamentos

Em **Cartões e parcelas → Importar parcelamentos em massa**, cole a tabela do Excel /
Google Sheets ou envie um CSV com a primeira linha de cabeçalhos:

```
descricao;categoria;cartao;valor_parcela;parcela_atual;total_parcelas;mes_inicial;valor_total;responsavel;observacoes
Notebook;Casa;Nubank;250,00;3;10;08/2026;2500,00;Suellen;compra da Magalu
```

Aceita `;`, `,` ou tabulação; valores em formato brasileiro (`1.234,56`); meses como
`08/2026`, `ago/2026` ou `2026-08`. Cartões inexistentes são criados automaticamente
e novas compras parceladas somam-se à coleção existente.

## Estrutura do código

```
index.html          shell da aplicação
css/styles.css      identidade visual (tons pastéis)
js/
  app.js            roteador, navegação e onboarding
  store.js          persistência (localStorage) e catálogos padrão
  calc.js           cálculos financeiros, projeções e alertas
  charts.js         gráficos SVG (rosca, barras, linhas) com tooltips
  ui.js             componentes (modal, formulário, tabela, badges)
  utils.js          formatação, datas e CSV
  views/            uma tela por arquivo
```

Sem dependências externas: HTML + CSS + JavaScript puro (ES modules).

## Sincronização entre celular e computador (Supabase)

O Supabase fornece o **banco de dados na nuvem** (com login por e-mail e senha);
a hospedagem do app fica no GitHub Pages. Com os dois configurados, os mesmos dados
aparecem em todos os seus aparelhos.

### Parte 1 — criar o banco no Supabase (5 minutos, grátis)

1. Crie uma conta em [supabase.com](https://supabase.com) e clique em **New project**
   (escolha um nome, uma senha do banco e a região `South America (São Paulo)`).
2. No menu lateral, abra **SQL Editor → New query**, cole o conteúdo do arquivo
   [`supabase/schema.sql`](supabase/schema.sql) deste repositório e clique em **Run**.
3. Ainda no Supabase, vá em **Settings → API** e copie dois valores:
   - **Project URL** (ex.: `https://abcdefgh.supabase.co`)
   - **anon public** (a chave pública — pode ficar no app, a segurança vem das
     políticas RLS criadas no passo 2)
4. (Opcional) Em **Authentication → Providers → Email**, desative
   *Confirm email* se não quiser precisar clicar no link de confirmação.

### Parte 2 — hospedar o app (grátis: Netlify ou GitHub Pages)

**Opção A — Netlify (recomendada, com deploy automático):**

1. Crie uma conta em [app.netlify.com](https://app.netlify.com) (pode entrar com o GitHub).
2. Clique em **Add new project → Import an existing project → GitHub** e escolha o
   repositório `app-financeiro` (e a branch desejada).
3. O `netlify.toml` do repositório já configura tudo (site estático, sem build) —
   basta clicar em **Deploy**. O app fica em `https://SEU-SITE.netlify.app`, e cada
   `git push` republica sozinho.

**Opção A2 — Netlify sem GitHub (arrastar e soltar):** acesse
[app.netlify.com/drop](https://app.netlify.com/drop) e arraste o zip do site
(gere com `zip -r site.zip index.html css js` ou use o zip pronto). Simples,
mas as atualizações futuras exigem arrastar de novo.

**Opção B — GitHub Pages:**

1. No GitHub, abra o repositório → **Settings → Pages**.
2. Em *Build and deployment*, escolha **Deploy from a branch**, selecione a branch
   principal e a pasta `/ (root)` e salve.
3. Em ~1 minuto o app estará no ar em `https://SEU-USUARIO.github.io/app-financeiro/`.
   Abra esse endereço no computador **e** no celular (dá até para "Adicionar à tela
   inicial" no celular, que vira um ícone de app).

### Parte 3 — conectar o app ao banco

1. No app, abra **Configurações → ☁️ Sincronização entre dispositivos**.
2. Clique em **Conectar projeto Supabase** e cole a URL e a chave anon.
3. Clique em **Criar conta** (uma vez só) e depois **Entrar** com e-mail e senha.
4. Repita o login nos outros aparelhos, com o mesmo e-mail: o app detecta os dados
   da nuvem e pergunta se quer usá-los.

A partir daí a sincronização é automática: cada alteração é enviada ~2 s depois,
e ao voltar para o app ele busca novidades da nuvem. Também há o botão
**Sincronizar agora** nas Configurações.

**Como os dados são combinados:** a sincronização é por **mesclagem** — os
lançamentos do celular e do computador são unidos item a item (nada é apagado
por sincronizar). Se o mesmo item foi editado nos dois aparelhos, vale a edição
mais recente; exclusões são propagadas para os demais aparelhos.

**Conectar outro aparelho sem redigitar:** em **Configurações → 📲 Conectar
outro aparelho**, o app gera um link (para copiar ou enviar por WhatsApp/e-mail)
que já configura o projeto no novo aparelho — lá basta entrar com o mesmo
e-mail e senha. O link carrega apenas o endereço do projeto e a chave pública,
nunca a senha. Na versão de arquivo único, cole o link recebido no campo
"ID do projeto" do botão Conectar.

**Verificar se está tudo certo:** o botão **🔍 Testar configuração** (em
Configurações) confere no seu navegador se o projeto está no ar, se a chave é
válida, se a tabela foi criada e se o login está ativo — com instruções para
cada pendência.

## Versão em arquivo único

Para usar sem servidor (basta dar duplo clique no arquivo):

```bash
node tools/build-standalone.mjs
# gera dist/meu-orcamento-inteligente.html com CSS e JS embutidos
```
