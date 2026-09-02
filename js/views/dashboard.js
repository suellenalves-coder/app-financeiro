// Dashboard mensal: visão consolidada agrupada em blocos com hierarquia visual clara,
// em vez de uma lista longa de cards soltos.
import { h, fmt, fmtPct, ymAdd, ymShort } from '../utils.js';
import { ui, db, isSectionVisible } from '../store.js';
import {
  monthSummary, commitmentBreakdown, expensesByCategory, alertsFor, futureInstallmentsTotal,
  accountBalance, topCategoriesComparison, monthSummary as ms,
} from '../calc.js';
import { statCard, card, section, heroStat, alertBanner, table } from '../ui.js';
import { donut, hstack, lines, bars, CHART_COLORS } from '../charts.js';
import { contaLabel } from './contas.js';

export function render(el) {
  const ym = ui.month;
  const s = monthSummary(ym);
  const alerts = alertsFor(ym);
  const tone = v => v < 0 ? 'tone-bad' : 'tone-ok';

  el.append(alertBanner(alerts) || '');

  // ---- O número mais importante da tela, em destaque acima de tudo ----
  el.append(heroStat('Saldo livre real do mês', s.saldoLivreReal, {
    sub: 'o que sobra da sua renda segura depois de todos os compromissos',
    bad: s.saldoLivreReal < 0,
  }));

  // ---- Minhas Contas ----
  el.append(section('🏛️', 'Minhas Contas',
    !db.accounts.length
      ? h('div', { class: 'empty-state' }, 'Nenhuma conta cadastrada. ',
          h('a', { href: '#/contas' }, 'Cadastre suas contas bancárias'), ' para acompanhar o saldo real aqui.')
      : h('div', { class: 'grid grid-cards' },
          db.accounts.map(a => statCard(contaLabel(a), accountBalance(a.id), {
            tone: accountBalance(a.id) < 0 ? 'tone-bad' : 'tone-ok',
            onclick: () => location.hash = '#/contas',
          })))));

  // ---- Visão geral do mês ----
  el.append(section('📊', 'Visão geral do mês',
    h('div', { class: 'grid grid-cards' },
      statCard('Receita total do mês', s.receitaTotal),
      statCard('Receita segura', s.receitaSegura, { sub: 'salário e rendas garantidas' }),
      statCard('Receita variável', s.receitaVariavel),
      statCard('Despesas totais', s.despesasTotais),
      statCard('Despesas fixas', s.despesasFixas, { sub: 'inclui contas recorrentes' }),
      statCard('Despesas variáveis', s.despVariaveis),
      statCard('Saldo previsto', s.saldoPrevisto, { tone: tone(s.saldoPrevisto) }),
      statCard('Saldo livre real', s.saldoLivreReal, { tone: tone(s.saldoLivreReal), sub: 'livre de verdade para gastar' }),
      statCard('Renda comprometida', fmtPct(s.comprometimento), {
        tone: s.comprometimento > 85 ? 'tone-bad' : s.comprometimento > 70 ? 'tone-warn' : 'tone-ok',
      }))));

  // ---- Comprometimento e dívidas ----
  const bd = commitmentBreakdown(ym);
  const colors = [CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[4], CHART_COLORS[3], CHART_COLORS[0], '#D8E2DC'];
  const meterColor = s.comprometimento > 85 ? '#E57373' : s.comprometimento > 70 ? '#F6C667' : '#7BC99A';
  el.append(section('⚖️', 'Comprometimento e dívidas',
    h('div', { class: 'grid grid-cards' },
      statCard('Parcelamentos do mês', s.parcelamentos, { onclick: () => location.hash = '#/cartoes' }),
      statCard('Parcelamentos futuros já comprometidos', futureInstallmentsTotal(ym),
        { sub: 'a partir do mês seguinte', onclick: () => location.hash = '#/cartoes' })),
    card('Comprometimento da renda segura',
      h('div', { class: 'commit-meter' },
        h('div', { style: `width:${Math.min(100, s.comprometimento)}%;background:${meterColor}` })),
      h('div', { class: 'stat-sub', style: 'margin-bottom:10px' },
        s.receitaSegura > 0
          ? `${fmtPct(s.comprometimento)} da renda segura já está comprometida. Saldo livre real: ${fmt(s.saldoLivreReal)}.`
          : 'Cadastre sua receita segura para acompanhar o comprometimento.'),
      bd.receitaSegura > 0 ? hstack(bd.partes.map(([l, v], i) => [l, v, colors[i]]), bd.receitaSegura) : null)));

  // ---- Gastos ----
  const cats = expensesByCategory(ym);
  const months = Array.from({ length: 13 }, (_, i) => ymAdd(ym, i - 6));
  el.append(section('🛍️', 'Gastos',
    h('div', { class: 'grid grid-2' },
      card('Despesas por categoria', donut(cats)),
      card('Fixas × variáveis × parcelas',
        bars([ymShort(ym)], [
          { name: 'Fixas', color: CHART_COLORS[0], values: [s.despesasFixas] },
          { name: 'Variáveis', color: CHART_COLORS[1], values: [s.despVariaveis] },
          { name: 'Parcelas', color: CHART_COLORS[2], values: [s.parcelamentos] },
        ], { height: 200 }))),
    card('Evolução do saldo livre real (projeção inclui parcelas futuras)',
      lines(months.map(ymShort), [
        { name: 'Saldo livre real', color: CHART_COLORS[0], values: months.map(m => ms(m).saldoLivreReal) },
      ], { height: 210 })),
    budgetCard(ym, cats),
    topCategoriesCard(ym)));

  // ---- A receber e investir ----
  el.append(section('💰', 'A receber e investir',
    h('div', { class: 'grid grid-cards' }, [
      statCard('Reembolsos a receber', s.reembolsosAReceber, { tone: s.reembolsosAReceber > 0 ? 'tone-warn' : '', onclick: () => location.hash = '#/reembolsos' }),
      statCard('Investimentos do mês', s.investimentos, { sub: `realizado: ${fmt(s.investRealizado)}`, onclick: () => location.hash = '#/investimentos' }),
      isSectionVisible('provisoes') ? statCard('Provisões do mês', s.provisoes, { onclick: () => location.hash = '#/provisoes' }) : null,
      statCard('Contas recorrentes do mês', s.recorrentes, { onclick: () => location.hash = '#/recorrentes' }),
    ].filter(Boolean))));
}

// Barra de progresso (gasto atual / limite definido) por categoria com orçamento configurado.
function budgetCard(ym, cats) {
  const gastoPorCategoria = Object.fromEntries(cats);
  const rows = db.categoryBudgets
    .filter(b => Number(b.limiteMensal) > 0)
    .map(b => ({ categoria: b.categoria, gasto: gastoPorCategoria[b.categoria] || 0, limite: Number(b.limiteMensal) }))
    .sort((a, b) => (b.gasto / b.limite) - (a.gasto / a.limite));

  if (!rows.length) {
    return card('Orçamento por categoria',
      h('p', { class: 'stat-sub' }, 'Nenhum limite definido ainda. ',
        h('a', { href: '#/config' }, 'Defina limites mensais por categoria em Configurações'), ' para acompanhar aqui.'));
  }
  return card('Orçamento por categoria',
    rows.map(r => {
      const pct = r.limite > 0 ? r.gasto / r.limite * 100 : 0;
      const over = pct > 100;
      const color = over ? '#E57373' : pct > 80 ? '#F6C667' : '#7BC99A';
      return h('div', { class: 'budget-row' },
        h('div', { class: 'budget-row-head' },
          h('span', { class: 'cat-name' }, r.categoria),
          h('span', { class: over ? 'budget-over-text' : '' }, `${fmt(r.gasto)} / ${fmt(r.limite)}`)),
        h('div', { class: 'budget-meter' }, h('div', { style: `width:${Math.min(100, pct)}%;background:${color}` })));
    }));
}

// As 3 categorias que mais pesaram no mês, comparadas ao mês anterior.
function topCategoriesCard(ym) {
  const top = topCategoriesComparison(ym);
  if (!top.length) return null;
  return card('Top 3 categorias do mês',
    table([
      { label: 'Categoria', k: 'categoria' },
      { label: 'Este mês', render: r => fmt(r.valor), right: true },
      { label: 'Mês anterior', render: r => fmt(r.valorAnterior), right: true },
      { label: 'Variação', render: r => h('span', {
          style: `color:${r.delta > 0 ? '#C0504D' : r.delta < 0 ? '#2E7D53' : 'inherit'};font-weight:600`,
        }, `${r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '—'} ${fmt(Math.abs(r.delta))}`), right: true },
    ], top, { responsive: true }));
}
