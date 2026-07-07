// Dashboard anual: acumulados, projeções e tabela mês a mês.
import { h, fmt, fmtPct, ymShort, ymNow, ymDiff, sum, ymOf } from '../utils.js';
import { ui, db } from '../store.js';
import { annualRows, totalInvested, reserveTotal, futureInstallmentsTotal, monthInvestDone, reimbOutstanding } from '../calc.js';
import { statCard, card, table } from '../ui.js';
import { lines, bars, CHART_COLORS } from '../charts.js';

export function render(el, rerender) {
  const year = ui.year;
  el.append(h('div', { class: 'topbar' },
    h('div', { class: 'month-picker' },
      h('button', { onclick: () => { ui.year--; rerender(); } }, '‹'),
      h('span', { class: 'month-label' }, String(year)),
      h('button', { onclick: () => { ui.year++; rerender(); } }, '›'))));

  const rows = annualRows(year);
  const now = ymNow();
  const passados = rows.filter(r => ymDiff(r.ym, now) <= 0);

  const reembolsosRecebidos = sum(
    db.reimbursements.filter(r => r.dataRecebimento && ymOf(r.dataRecebimento).startsWith(String(year))),
    r => r.valorRecebido);

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Receitas no ano', sum(rows, r => r.receitaTotal), { sub: 'realizado + previsto' }),
    statCard('Despesas no ano', sum(rows, r => r.despesasTotais)),
    statCard('Investimentos aportados', sum(rows.map(r => monthInvestDone(r.ym)))),
    statCard('Provisões planejadas', sum(rows, r => r.provisoes)),
    statCard('Reembolsos recebidos', reembolsosRecebidos),
    statCard('Reembolsos pendentes', reimbOutstanding(), { tone: reimbOutstanding() > 0 ? 'tone-warn' : '' }),
    statCard('Saldo líquido acumulado', sum(rows, r => r.saldoPrevisto), { tone: sum(rows, r => r.saldoPrevisto) < 0 ? 'tone-bad' : 'tone-ok' }),
    statCard('Parcelas futuras comprometidas', futureInstallmentsTotal(now)),
    statCard('Patrimônio investido hoje', totalInvested(), { tone: 'tone-accent' }),
    statCard('Reserva de emergência', reserveTotal(), {
      sub: db.settings.metaReservaMin ? `meta mínima: ${fmt(db.settings.metaReservaMin)}` : '',
      tone: reserveTotal() < db.settings.metaReservaMin ? 'tone-warn' : 'tone-ok',
    })));

  const labels = rows.map(r => ymShort(r.ym));
  el.append(card('Receitas, despesas e investimentos mês a mês',
    lines(labels, [
      { name: 'Receitas', color: CHART_COLORS[0], values: rows.map(r => r.receitaTotal) },
      { name: 'Despesas', color: CHART_COLORS[2], values: rows.map(r => r.despesasTotais) },
      { name: 'Investimentos', color: CHART_COLORS[1], values: rows.map(r => r.investimentos) },
    ])));

  el.append(h('div', { class: 'grid grid-2' },
    card('Saldo previsto por mês',
      bars(labels, [{ name: 'Saldo previsto', color: CHART_COLORS[3], values: rows.map(r => r.saldoPrevisto) }], { height: 200 })),
    card('Parcelamentos comprometidos por mês',
      bars(labels, [{ name: 'Parcelas', color: CHART_COLORS[4], values: rows.map(r => r.parcelamentos) }], { height: 200 }))));

  const futuro = r => ymDiff(r.ym, now) > 0;
  el.append(card(`Tabela mês a mês de ${year} (meses futuros são projeção)`,
    table([
      { label: 'Mês', render: r => h('span', { style: futuro(r) ? 'color:var(--ink-2);font-style:italic' : 'font-weight:600' }, ymShort(r.ym)) },
      { label: 'Receita segura', k: 'receitaSegura', money: true },
      { label: 'Receita variável', k: 'receitaVariavel', money: true },
      { label: 'Desp. fixas', k: 'despesasFixas', money: true },
      { label: 'Desp. variáveis', k: 'despVariaveis', money: true },
      { label: 'Parcelas', k: 'parcelamentos', money: true },
      { label: 'Provisões', k: 'provisoes', money: true },
      { label: 'Invest.', k: 'investimentos', money: true },
      { label: 'Reemb. a receber', k: 'reembolsosMes', money: true },
      { label: 'Saldo previsto', render: r => h('span', { style: r.saldoPrevisto < 0 ? 'color:var(--erro);font-weight:600' : '' }, fmt(r.saldoPrevisto)), right: true },
      { label: 'Saldo livre real', render: r => h('span', { style: r.saldoLivreReal < 0 ? 'color:var(--erro);font-weight:600' : 'color:#2E7D53;font-weight:600' }, fmt(r.saldoLivreReal)), right: true },
      { label: 'Comprometido', render: r => fmtPct(r.comprometimento), right: true },
    ], rows)));
}
