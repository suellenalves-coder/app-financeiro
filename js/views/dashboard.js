// Dashboard mensal: visão consolidada, comprometimento da renda e alertas.
import { h, fmt, fmtPct, ymAdd, ymShort } from '../utils.js';
import { ui, db } from '../store.js';
import { monthSummary, commitmentBreakdown, expensesByCategory, alertsFor, futureInstallmentsTotal, monthSummary as ms } from '../calc.js';
import { statCard, card, alertBanner } from '../ui.js';
import { donut, hstack, lines, bars, CHART_COLORS, CHART_MUTED } from '../charts.js';

export function render(el) {
  const ym = ui.month;
  const s = monthSummary(ym);
  const alerts = alertsFor(ym);

  el.append(alertBanner(alerts) || '');

  const tone = v => v < 0 ? 'tone-bad' : 'tone-ok';
  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Receita total do mês', s.receitaTotal),
    statCard('Receita segura', s.receitaSegura, { sub: 'salário e rendas garantidas' }),
    statCard('Receita variável', s.receitaVariavel),
    statCard('Despesas totais', s.despesasTotais),
    statCard('Despesas fixas', s.despesasFixas, { sub: 'inclui contas recorrentes' }),
    statCard('Despesas variáveis', s.despVariaveis),
    statCard('Parcelamentos do mês', s.parcelamentos, { onclick: () => location.hash = '#/cartoes' }),
    statCard('Provisões do mês', s.provisoes, { onclick: () => location.hash = '#/provisoes' }),
    statCard('Investimentos do mês', s.investimentos, { sub: `realizado: ${fmt(s.investRealizado)}`, onclick: () => location.hash = '#/investimentos' }),
    statCard('Reembolsos a receber', s.reembolsosAReceber, { tone: s.reembolsosAReceber > 0 ? 'tone-warn' : '', onclick: () => location.hash = '#/reembolsos' }),
    statCard('Saldo previsto', s.saldoPrevisto, { tone: tone(s.saldoPrevisto) }),
    statCard('Saldo livre real', s.saldoLivreReal, { tone: tone(s.saldoLivreReal), sub: 'livre de verdade para gastar' }),
    statCard('Renda comprometida', fmtPct(s.comprometimento), {
      tone: s.comprometimento > 85 ? 'tone-bad' : s.comprometimento > 70 ? 'tone-warn' : 'tone-ok',
    })));

  // Comprometimento da renda
  const bd = commitmentBreakdown(ym);
  const colors = [CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[4], CHART_COLORS[3], CHART_COLORS[0], '#D8E2DC'];
  const meterColor = s.comprometimento > 85 ? '#E57373' : s.comprometimento > 70 ? '#F6C667' : '#7BC99A';
  el.append(card('Comprometimento da renda segura',
    h('div', { class: 'commit-meter' },
      h('div', { style: `width:${Math.min(100, s.comprometimento)}%;background:${meterColor}` })),
    h('div', { class: 'stat-sub', style: 'margin-bottom:10px' },
      s.receitaSegura > 0
        ? `${fmtPct(s.comprometimento)} da renda segura já está comprometida. Saldo livre real: ${fmt(s.saldoLivreReal)}.`
        : 'Cadastre sua receita segura para acompanhar o comprometimento.'),
    bd.receitaSegura > 0 ? hstack(bd.partes.map(([l, v], i) => [l, v, colors[i]]), bd.receitaSegura) : null));

  // Gráficos lado a lado
  const cats = expensesByCategory(ym);
  el.append(h('div', { class: 'grid grid-2' },
    card('Despesas por categoria', donut(cats)),
    card('Fixas × variáveis × parcelas',
      bars([ymShort(ym)], [
        { name: 'Fixas', color: CHART_COLORS[0], values: [s.despesasFixas] },
        { name: 'Variáveis', color: CHART_COLORS[1], values: [s.despVariaveis] },
        { name: 'Parcelas', color: CHART_COLORS[2], values: [s.parcelamentos] },
      ], { height: 200 }))));

  // Evolução do saldo livre (6 meses atrás + 6 à frente)
  const months = Array.from({ length: 13 }, (_, i) => ymAdd(ym, i - 6));
  el.append(card('Evolução do saldo livre real (projeção inclui parcelas futuras)',
    lines(months.map(ymShort), [
      { name: 'Saldo livre real', color: CHART_COLORS[0], values: months.map(m => ms(m).saldoLivreReal) },
    ], { height: 210 })));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Parcelamentos futuros já comprometidos', futureInstallmentsTotal(ym),
      { sub: 'a partir do mês seguinte', onclick: () => location.hash = '#/cartoes' }),
    statCard('Contas recorrentes do mês', s.recorrentes, { onclick: () => location.hash = '#/recorrentes' })));
}
