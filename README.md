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

## Versão em arquivo único

Para usar sem servidor (basta dar duplo clique no arquivo):

```bash
node tools/build-standalone.mjs
# gera dist/meu-orcamento-inteligente.html com CSS e JS embutidos
```
