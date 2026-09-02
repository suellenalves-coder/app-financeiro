// Calendário financeiro: tudo que acontece no mês, dia a dia.
import { h, fmt, fmtDate, daysInMonth, dateInMonth, todayISO, daysUntil, sum } from '../utils.js';
import { db, ui } from '../store.js';
import { monthIncomes, monthExpenses, recurringOccurrences, cardInvoice, monthReimbursements, reimbPending, provisionMonthly } from '../calc.js';
import { card, modal, badge, alertBanner, table } from '../ui.js';

const TIPOS = {
  receita: { icon: '💰', bg: '#E3F5EB' },
  despesa: { icon: '🧾', bg: '#F4D6DA' },
  recorrente: { icon: '🔁', bg: '#EDE3D4' },
  fatura: { icon: '💳', bg: '#D9CCF2' },
  provisao: { icon: '🏦', bg: '#EEF1F4' },
  investimento: { icon: '📈', bg: '#C9E7F6' },
  reembolso: { icon: '🤝', bg: '#FCF3DD' },
};

function eventsFor(ym) {
  const ev = [];
  for (const i of monthIncomes(ym)) {
    ev.push({ tipo: 'receita', data: i.data, titulo: i.descricao, valor: i.valor, status: i.status });
  }
  for (const e of monthExpenses(ym)) {
    const venc = e.dataVencimento || e.dataCompra;
    const status = e.status === 'previsto' && daysUntil(venc) < 0 ? 'vencido' : e.status;
    ev.push({ tipo: 'despesa', data: venc, titulo: e.descricao, valor: e.valorTotal, status });
  }
  for (const o of recurringOccurrences(ym)) {
    ev.push({ tipo: 'recorrente', data: o.dataVencimento, titulo: o.nome, valor: o.valor, status: o.status });
  }
  for (const c of db.cards.filter(c => c.ativo !== false && c.diaVencimento)) {
    const inv = cardInvoice(c.id, ym);
    if (inv.total > 0) {
      ev.push({ tipo: 'fatura', data: dateInMonth(ym, Number(c.diaVencimento)), titulo: `Fatura ${c.nome}`, valor: inv.total, status: inv.pago >= inv.total ? 'pago' : 'previsto' });
    }
  }
  const prov = sum(db.provisions, p => provisionMonthly(p, ym));
  if (prov > 0) ev.push({ tipo: 'provisao', data: dateInMonth(ym, 1), titulo: 'Provisões do mês', valor: prov, status: 'previsto' });
  const aportes = sum(db.investments, i => i.aporteMensalPlanejado);
  if (aportes > 0) ev.push({ tipo: 'investimento', data: dateInMonth(ym, 1), titulo: 'Aportes planejados', valor: aportes, status: 'previsto' });
  for (const r of monthReimbursements(ym)) {
    if (reimbPending(r) > 0) {
      ev.push({ tipo: 'reembolso', data: r.data, titulo: `Reembolso: ${r.descricao}`, valor: reimbPending(r), status: r.status });
    }
  }
  return ev;
}

export function render(el, rerender) {
  const ym = ui.month;
  const events = eventsFor(ym);
  const hoje = todayISO();

  // Alertas de proximidade
  const alerts = [];
  for (const e of events) {
    if (['pago', 'recebida', 'cancelado'].includes(e.status)) continue;
    const d = daysUntil(e.data);
    const nome = `${TIPOS[e.tipo].icon} ${e.titulo} (${fmt(e.valor)})`;
    if (e.status === 'vencido' || (d < 0 && ['previsto', 'prevista', 'pendente'].includes(e.status) && e.tipo !== 'reembolso')) {
      alerts.push({ level: 'erro', msg: `${nome} está vencido desde ${fmtDate(e.data)}.` });
    } else if (d === 0) alerts.push({ level: 'aviso', msg: `${nome} vence hoje.` });
    else if (d > 0 && d <= 3) alerts.push({ level: 'aviso', msg: `${nome} vence em ${d} dia${d > 1 ? 's' : ''}.` });
    else if (e.tipo === 'reembolso' && e.status === 'solicitado') {
      alerts.push({ level: 'info', msg: `${nome} foi solicitado e ainda não foi pago.` });
    }
  }
  el.append(alertBanner(alerts.slice(0, 6)) || '');

  // Grade do calendário
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const total = daysInMonth(ym);
  const cells = [];
  for (const dow of ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']) cells.push(h('div', { class: 'cal-dow' }, dow));
  for (let i = 0; i < first; i++) cells.push(h('div', { class: 'cal-day other' }));
  for (let d = 1; d <= total; d++) {
    const iso = dateInMonth(ym, d);
    const dayEvents = events.filter(e => e.data === iso);
    const items = dayEvents.slice(0, 3).map(e => h('div', {
      class: 'cal-item', style: `background:${TIPOS[e.tipo].bg};${e.status === 'vencido' ? 'outline:1px solid #E57373;' : ''}`,
      title: `${e.titulo} · ${fmt(e.valor)}`,
    }, `${TIPOS[e.tipo].icon} ${e.titulo}`));
    if (dayEvents.length > 3) items.push(h('div', { class: 'cal-more' }, `+${dayEvents.length - 3} itens`));
    cells.push(h('div', {
      class: `cal-day ${iso === hoje ? 'today' : ''}`,
      onclick: () => dayEvents.length && dayModal(iso, dayEvents),
    }, h('div', { class: 'cal-num' }, d), items));
  }
  el.append(card(null, h('div', { class: 'cal-grid' }, cells)));

  // Legenda
  el.append(card('Legenda', h('div', { class: 'chart-legend', style: 'justify-content:flex-start' },
    Object.entries({ receita: 'Receitas', despesa: 'Despesas', recorrente: 'Contas recorrentes', fatura: 'Faturas de cartão', provisao: 'Provisões', investimento: 'Investimentos', reembolso: 'Reembolsos esperados' })
      .map(([k, label]) => h('span', { class: 'legend-item' },
        h('span', { class: 'legend-dot', style: `background:${TIPOS[k].bg}` }), `${TIPOS[k].icon} ${label}`)))));
}

function dayModal(iso, events) {
  modal(`Dia ${fmtDate(iso)}`, h('div', {},
    table([
      { label: '', render: e => TIPOS[e.tipo].icon },
      { label: 'Item', k: 'titulo' },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Status', render: e => badge(e.status) },
    ], events, { responsive: true }),
    h('div', { class: 'stat-sub', style: 'margin-top:10px' },
      `Total do dia: ${fmt(sum(events.filter(e => e.tipo !== 'receita'), e => e.valor))} em compromissos · ${fmt(sum(events.filter(e => e.tipo === 'receita'), e => e.valor))} em receitas.`)));
}
