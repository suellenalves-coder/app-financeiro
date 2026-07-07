// Investimentos: carteira por banco e produto, aportes e meta de reserva.
import { h, fmt, todayISO, ymOf, sum } from '../utils.js';
import { db, ui, add, update, remove, TIPOS_INVESTIMENTO, OBJETIVOS_INVESTIMENTO } from '../store.js';
import { totalInvested, reserveTotal, monthInvestDone, monthInvestPlanned } from '../calc.js';
import { card, table, formModal, confirmModal, rowActions, statCard, toast, alertBanner } from '../ui.js';
import { donut } from '../charts.js';

function fields() {
  return [
    { k: 'banco', label: 'Banco ou corretora', type: 'select', options: db.banks.map(b => b.nome), required: true },
    { k: 'produto', label: 'Produto', type: 'text', required: true, placeholder: 'Ex.: CDB 110% CDI, Tesouro Selic…' },
    { k: 'tipo', label: 'Tipo de investimento', type: 'select', options: TIPOS_INVESTIMENTO, required: true },
    { k: 'objetivo', label: 'Objetivo', type: 'select', options: OBJETIVOS_INVESTIMENTO },
    { k: 'valorAtual', label: 'Valor atual (R$)', type: 'money', required: true },
    { k: 'aporteMensalPlanejado', label: 'Aporte mensal planejado (R$)', type: 'money', value: 0 },
    { k: 'rentabilidade', label: 'Rentabilidade (se souber)', type: 'text', placeholder: 'Ex.: 110% CDI, IPCA+6%' },
    { k: 'liquidez', label: 'Liquidez', type: 'select', options: ['Diária', 'D+30', 'No vencimento', 'Baixa'] },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

export function render(el, rerender) {
  const ym = ui.month;
  const reserva = reserveTotal();
  const metaMin = Number(db.settings.metaReservaMin) || 0;
  const planejado = monthInvestPlanned();
  const realizado = monthInvestDone(ym);

  if (metaMin > 0 && reserva < metaMin) {
    el.append(alertBanner([{ level: 'aviso', msg: `Sua reserva (${fmt(reserva)}) está abaixo da meta mínima definida (${fmt(metaMin)}).` }]));
  }

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Total investido', totalInvested(), { tone: 'tone-accent' }),
    statCard('Reserva de emergência', reserva, {
      sub: metaMin ? `meta: ${fmt(metaMin)}${db.settings.metaReservaMax ? ' – ' + fmt(db.settings.metaReservaMax) : ''} (${metaMin ? Math.min(999, Math.round(reserva / metaMin * 100)) : 0}%)` : 'defina a meta em Configurações',
      tone: metaMin && reserva < metaMin ? 'tone-warn' : 'tone-ok',
    }),
    statCard('Aporte planejado / mês', planejado),
    statCard('Aporte realizado no mês', realizado, {
      tone: realizado >= planejado && planejado > 0 ? 'tone-ok' : realizado < planejado ? 'tone-warn' : '',
      sub: planejado > 0 ? `${Math.round(realizado / planejado * 100)}% do planejado` : '',
    })));

  // Distribuição por banco e por tipo
  const porBanco = agrupa(i => i.banco);
  const porTipo = agrupa(i => i.tipo);
  if (db.investments.length) {
    el.append(h('div', { class: 'grid grid-2' },
      card('Total por banco', donut(porBanco, { size: 170 })),
      card('Total por tipo de produto', donut(porTipo, { size: 170 }))));
  }

  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, 'Sua carteira'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Novo investimento', fields(), {}, vals => { add('investments', vals); rerender(); }) }, '+ Novo investimento')),
    table([
      { label: 'Banco', k: 'banco' },
      { label: 'Produto', k: 'produto' },
      { label: 'Tipo', k: 'tipo' },
      { label: 'Objetivo', k: 'objetivo' },
      { label: 'Valor atual', k: 'valorAtual', money: true },
      { label: 'Aporte/mês', k: 'aporteMensalPlanejado', money: true },
      { label: 'Liquidez', k: 'liquidez' },
      { label: '', render: i => rowActions(
          ['💰', () => aporteModal(i, rerender), 'Registrar aporte'],
          ['✏️', () => formModal('Editar investimento', fields(), i, vals => { update('investments', i.id, vals); rerender(); }), 'Editar'],
          ['🗑', () => confirmModal(`Excluir o investimento "${i.produto}"?`, () => { remove('investments', i.id); rerender(); }), 'Excluir']), right: true },
    ], db.investments, { empty: 'Nenhum investimento cadastrado. Separe o dinheiro investido do disponível para ver sua evolução patrimonial.' })));

  // Aportes do mês
  const aportes = db.investContrib.filter(c => ymOf(c.data) === ym);
  if (aportes.length) {
    el.append(card('Aportes registrados no mês',
      table([
        { label: 'Data', k: 'data', date: true },
        { label: 'Investimento', render: a => { const i = db.investments.find(x => x.id === a.investimentoId); return i ? `${i.banco} · ${i.produto}` : '—'; } },
        { label: 'Valor', k: 'valor', money: true },
        { label: '', render: a => rowActions(['🗑', () => confirmModal('Excluir este aporte? O valor será estornado do investimento.', () => {
            const inv = db.investments.find(x => x.id === a.investimentoId);
            if (inv) update('investments', inv.id, { valorAtual: (Number(inv.valorAtual) || 0) - a.valor });
            remove('investContrib', a.id);
            rerender();
          }), 'Excluir']), right: true },
      ], aportes)));
  }
}

function agrupa(keyFn) {
  const map = {};
  for (const i of db.investments) {
    const k = keyFn(i) || 'Outros';
    map[k] = (map[k] || 0) + (Number(i.valorAtual) || 0);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function aporteModal(inv, rerender) {
  formModal(`Aporte em ${inv.produto}`, [
    { k: 'valor', label: 'Valor do aporte (R$)', type: 'money', required: true, value: inv.aporteMensalPlanejado || '' },
    { k: 'data', label: 'Data', type: 'date', required: true, value: todayISO() },
  ], {}, vals => {
    add('investContrib', { investimentoId: inv.id, data: vals.data, valor: vals.valor });
    update('investments', inv.id, { valorAtual: (Number(inv.valorAtual) || 0) + vals.valor });
    toast('Aporte registrado.');
    rerender();
  }, { saveLabel: 'Registrar aporte' });
}
