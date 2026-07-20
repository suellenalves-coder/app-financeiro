// Reembolsos: resumo por pessoa (mês a mês), parcelamentos agrupados, detalhe, recebimento
// parcial e mensagem para WhatsApp.
import { h, fmt, fmtDate, todayISO, sum, ymShort, ymLabel } from '../utils.js';
import { db, ui, add, update, remove, save, STATUS_REEMBOLSO, CRITERIOS_DIVISAO, FORMAS_PAGAMENTO } from '../store.js';
import { reimbPending, reimbOutstanding, reimbMonth } from '../calc.js';
import { ensureReimbursementSync } from './cartoes.js';
import { card, table, badge, formModal, confirmModal, modal, rowActions, statCard, toast } from '../ui.js';

// Parcela X/Y correspondente a um reembolso ligado a uma compra do cartão (ou '—' se avulso).
function parcelaLabel(r) {
  if (!r.purchaseId || !r.mes) return '—';
  const i = db.installments.find(x => x.purchaseId === r.purchaseId && x.mes === r.mes);
  return i ? `${i.numero}/${i.total}` : '—';
}

// Agrupa os reembolsos de compras parceladas por compra: total do parcelamento, quanto
// falta, quanto é neste mês e em que mês termina — a visão que responde "quando acaba".
function purchaseGroups(ym, pessoaId) {
  const relevantes = db.reimbursements.filter(r =>
    r.purchaseId && r.status !== 'cancelado' && (!pessoaId || r.pessoaId === pessoaId));
  const map = new Map();
  for (const r of relevantes) {
    if (!map.has(r.purchaseId)) map.set(r.purchaseId, []);
    map.get(r.purchaseId).push(r);
  }
  const groups = [];
  for (const [purchaseId, list] of map) {
    const purchase = db.purchases.find(p => p.id === purchaseId);
    const sorted = [...list].sort((a, b) => (a.mes || '').localeCompare(b.mes || ''));
    const installmentsOf = db.installments.filter(i => i.purchaseId === purchaseId).sort((a, b) => a.numero - b.numero);
    const thisMonth = sorted.find(r => r.mes === ym);
    const totalPendente = sum(sorted, reimbPending);
    if (totalPendente <= 0.004) continue; // parcelamento já quitado por completo
    groups.push({
      purchaseId, items: sorted,
      pessoa: db.people.find(p => p.id === sorted[0]?.pessoaId),
      descricao: purchase?.descricao || sorted[0]?.descricao || '—',
      totalAReembolsar: sum(sorted, r => r.valorAReembolsar),
      totalRecebido: sum(sorted, r => r.valorRecebido),
      totalPendente,
      valorMes: thisMonth ? reimbPending(thisMonth) : 0,
      statusMes: thisMonth ? thisMonth.status : null,
      parcelaMes: thisMonth ? parcelaLabel(thisMonth) : '—',
      terminaEm: installmentsOf.length ? installmentsOf[installmentsOf.length - 1].mes : sorted[sorted.length - 1]?.mes,
    });
  }
  return groups.sort((a, b) => (a.terminaEm || '').localeCompare(b.terminaEm || ''));
}

function renderParcelamentos(ym, pessoaId) {
  const groups = purchaseGroups(ym, pessoaId);
  return card('Parcelamentos reembolsáveis',
    h('p', { class: 'stat-sub', style: 'margin-top:-4px' },
      'Total do parcelamento, quanto cai neste mês e em que mês termina — para saber exatamente até quando cobrar.'),
    table([
      { label: 'Descrição', k: 'descricao' },
      ...(pessoaId ? [] : [{ label: 'Pessoa', render: g => g.pessoa?.nome || '—' }]),
      { label: 'Parcela do mês', render: g => g.parcelaMes },
      { label: `Valor em ${ymShort(ym)}`, render: g => g.statusMes
          ? h(g.valorMes > 0 ? 'b' : 'span', {}, fmt(g.valorMes))
          : h('span', { class: 'stat-sub' }, 'sem parcela'), right: true },
      { label: 'Status do mês', render: g => g.statusMes ? badge(g.statusMes) : '—' },
      { label: 'Total do parcelamento', render: g => fmt(g.totalAReembolsar), right: true },
      { label: 'Total pendente', render: g => h(g.totalPendente > 0 ? 'b' : 'span', {}, fmt(g.totalPendente)), right: true },
      { label: 'Termina em', render: g => g.terminaEm ? h('b', {}, ymShort(g.terminaEm)) : '—' },
      { label: '', render: g => h('button', { class: 'btn btn-ghost btn-sm', onclick: () => detalhamentoModal(g) }, '📋 Detalhamento'), right: true },
    ], groups, { empty: 'Nenhum parcelamento reembolsável em aberto. Marque uma compra do cartão como reembolsável para ela aparecer aqui.' }));
}

// Detalhamento mês a mês de um parcelamento específico: cada parcela, seu status e se já foi
// recebida — responde "quando acaba" e "o que já entrou".
function detalhamentoModal(group) {
  modal(`Detalhamento — ${group.descricao}`, h('div', {},
    h('p', { class: 'stat-sub' },
      `${group.pessoa?.nome || 'Pessoa não definida'} · total do parcelamento: ${fmt(group.totalAReembolsar)} · já recebido: ${fmt(group.totalRecebido)} · termina em ${group.terminaEm ? ymLabel(group.terminaEm) : '—'}`),
    table([
      { label: 'Mês', render: r => h(r.mes === ui.month ? 'b' : 'span', {}, ymShort(r.mes)) },
      { label: 'Parcela', render: r => parcelaLabel(r) },
      { label: 'Valor', k: 'valorAReembolsar', money: true },
      { label: 'Recebido', k: 'valorRecebido', money: true },
      { label: 'Pendente', render: r => fmt(reimbPending(r)), right: true },
      { label: 'Status', render: r => badge(r.status) },
    ], group.items)));
}

let pessoaSelecionada = null;

function fields(vals = {}) {
  return [
    { k: 'data', label: 'Data da despesa', type: 'date', required: true, value: todayISO() },
    { k: 'descricao', label: 'Descrição', type: 'text', required: true },
    { k: 'valorTotalDespesa', label: 'Valor total da despesa (R$)', type: 'money', required: true,
      onchange: v => recalc(v) },
    { k: 'categoria', label: 'Categoria', type: 'select', options: db.categoriesExpense.map(c => c.nome) },
    { k: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS_PAGAMENTO },
    { k: 'pessoaId', label: 'Pessoa responsável pelo reembolso', type: 'select', required: true,
      options: db.people.map(p => [p.id, p.nome]),
      help: db.people.length ? '' : 'Cadastre pessoas em Configurações → Pessoas.' },
    { k: 'criterio', label: 'Critério de divisão', type: 'select', options: CRITERIOS_DIVISAO, value: 'fixo', required: true,
      onchange: v => recalc(v) },
    { k: 'percentual', label: 'Percentual (%)', type: 'number', min: 0, max: 100,
      show: v => v.criterio === 'percentual', onchange: v => recalc(v) },
    { k: 'valorAReembolsar', label: 'Valor a reembolsar (R$)', type: 'money', required: true },
    { k: 'status', label: 'Status', type: 'select', options: STATUS_REEMBOLSO, value: 'pendente', required: true },
    { k: 'comprovante', label: 'Comprovante (nome ou link)', type: 'text' },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

function recalc(v) {
  const total = Number(v.valorTotalDespesa) || 0;
  if (v.criterio === 'integral') v.valorAReembolsar = total;
  else if (v.criterio === 'igual') v.valorAReembolsar = +(total / 2).toFixed(2);
  else if (v.criterio === 'percentual') v.valorAReembolsar = +(total * (Number(v.percentual) || 0) / 100).toFixed(2);
}

export function render(el, rerender) {
  ensureReimbursementSync();
  if (pessoaSelecionada) return renderPessoa(el, rerender);

  const ym = ui.month;
  const ativos = db.reimbursements.filter(r => !['cancelado'].includes(r.status));
  const doMes = ativos.filter(r => reimbMonth(r) === ym);
  const avulsos = ativos.filter(r => !r.purchaseId);

  el.append(h('div', { class: 'grid grid-cards' },
    statCard(`Pendente em ${ymLabel(ym)}`, sum(doMes, reimbPending), { tone: sum(doMes, reimbPending) > 0 ? 'tone-warn' : 'tone-ok' }),
    statCard('Total a receber (todos os meses)', reimbOutstanding()),
    statCard('Solicitados', sum(ativos.filter(r => r.status === 'solicitado'), reimbPending)),
    statCard('Recebido no total', sum(db.reimbursements, r => r.valorRecebido), { tone: 'tone-ok' })));

  // Resumo por pessoa, priorizando o mês selecionado (dá pra ver quanto cada um deve NESTE mês).
  const porPessoa = db.people.map(p => {
    const items = ativos.filter(r => r.pessoaId === p.id);
    const itemsMes = items.filter(r => reimbMonth(r) === ym);
    return {
      pessoa: p,
      doMes: sum(itemsMes, reimbPending),
      countMes: itemsMes.length,
      pendente: sum(items.filter(r => ['pendente', 'atrasado'].includes(r.status)), reimbPending),
      solicitado: sum(items.filter(r => r.status === 'solicitado'), reimbPending),
      total: sum(items.filter(r => ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status)), reimbPending),
      ultimaSolicitacao: items.map(r => r.dataSolicitacao).filter(Boolean).sort().pop() || '',
      count: items.length,
    };
  }).filter(x => x.count > 0);

  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, `Quem me deve em ${ymLabel(ym)}`),
      h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => novaDespesaReembolsavel(rerender) }, '+ Despesa reembolsável'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => location.hash = '#/config' }, '👤 Gerenciar pessoas'))),
    table([
      { label: 'Pessoa', render: x => h('a', { href: '#', onclick: e => { e.preventDefault(); pessoaSelecionada = x.pessoa.id; rerender(); } }, h('b', {}, x.pessoa.nome)) },
      { label: `Deve em ${ymShort(ym)}`, render: x => h('b', {}, fmt(x.doMes)), right: true },
      { label: 'Total pendente (todos os meses)', render: x => fmt(x.total), right: true },
      { label: 'Última solicitação', render: x => x.ultimaSolicitacao ? fmtDate(x.ultimaSolicitacao) : '—' },
      { label: '', render: x => h('button', { class: 'btn btn-secondary btn-sm', onclick: () => messageModal(x.pessoa, ym) }, '💬 Gerar mensagem'), right: true },
    ], porPessoa, { empty: 'Nenhum reembolso registrado. Marque despesas ou compras do cartão como reembolsáveis, ou cadastre aqui direto.' })));

  el.append(renderParcelamentos(ym));
  if (avulsos.length) el.append(renderLista(avulsos, rerender, 'Reembolsos avulsos (despesas não parceladas)'));
  el.append(renderLista(doMes, rerender, `Ações do mês: reembolsos com competência em ${ymLabel(ym)}`,
    { empty: `Nenhum reembolso com competência em ${ymLabel(ym)}.` }));
  el.append(renderLista(ativos, rerender, 'Todos os reembolsos em aberto (qualquer mês)'));
}

function renderPessoa(el, rerender) {
  const p = db.people.find(x => x.id === pessoaSelecionada);
  if (!p) { pessoaSelecionada = null; return rerender(); }
  const ym = ui.month;
  const items = db.reimbursements.filter(r => r.pessoaId === p.id && r.status !== 'cancelado');
  const avulsos = items.filter(r => !r.purchaseId);
  const aberto = sum(items.filter(r => ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status)), reimbPending);
  const doMes = sum(items.filter(r => reimbMonth(r) === ym), reimbPending);

  el.append(h('div', { class: 'topbar' },
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { pessoaSelecionada = null; rerender(); } }, '← Voltar'),
    h('button', { class: 'btn btn-secondary btn-sm', onclick: () => messageModal(p, ym) }, '💬 Gerar mensagem')));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard(`Deve em ${ymLabel(ym)}`, doMes, { tone: doMes > 0 ? 'tone-warn' : 'tone-ok' }),
    statCard(`Total pendente (todos os meses)`, aberto, { tone: aberto > 0 ? 'tone-warn' : '' }),
    statCard('Já recebido', sum(items, r => r.valorRecebido), { tone: 'tone-ok' }),
    statCard('Lançamentos', String(items.length))));

  el.append(renderParcelamentos(ym, p.id));
  if (avulsos.length) el.append(renderLista(avulsos, rerender, `Reembolsos avulsos de ${p.nome}`));
  el.append(renderLista(items, rerender, `Histórico completo de ${p.nome} — mês a mês`));
}

function renderLista(items, rerender, title, opts = {}) {
  const sorted = [...items].sort((a, b) => (b.mes || b.data || '').localeCompare(a.mes || a.data || ''));
  return card(title, table([
    { label: 'Mês', render: r => h(reimbMonth(r) === ui.month ? 'b' : 'span', {}, ymShort(reimbMonth(r))) },
    { label: 'Parcela', render: r => parcelaLabel(r) },
    { label: 'Descrição', k: 'descricao' },
    { label: 'Pessoa', render: r => db.people.find(p => p.id === r.pessoaId)?.nome || '—' },
    { label: 'A reembolsar', k: 'valorAReembolsar', money: true },
    { label: 'Recebido', k: 'valorRecebido', money: true },
    { label: 'Pendente', render: r => h(reimbPending(r) > 0 ? 'b' : 'span', {}, fmt(reimbPending(r))), right: true },
    { label: 'Status', render: r => badge(r.status) },
    { label: '', render: r => actions(r, rerender), right: true },
  ], sorted, { empty: opts.empty || 'Nenhum reembolso.' }));
}

function actions(r, rerender) {
  const btns = [];
  if (['pendente', 'atrasado'].includes(r.status)) {
    btns.push(['📨', () => { update('reimbursements', r.id, { status: 'solicitado', dataSolicitacao: todayISO() }); toast('Marcado como solicitado.'); rerender(); }, 'Marcar como solicitado']);
  }
  if (reimbPending(r) > 0 && !['cancelado', 'contestado'].includes(r.status)) {
    btns.push(['💵', () => receberModal(r, rerender), 'Registrar recebimento']);
  }
  btns.push(
    ['✏️', () => formModal('Editar reembolso', fields(), r, vals => { update('reimbursements', r.id, vals); rerender(); }, { wide: true }), 'Editar'],
    ['🗑', () => confirmModal(`Excluir o reembolso "${r.descricao}"?`, () => { remove('reimbursements', r.id); rerender(); }), 'Excluir']);
  return rowActions(...btns);
}

function receberModal(r, rerender) {
  formModal(`Receber de ${db.people.find(p => p.id === r.pessoaId)?.nome || ''}`, [
    { k: 'valor', label: `Valor recebido (pendente: ${fmt(reimbPending(r))})`, type: 'money', required: true, value: reimbPending(r) },
    { k: 'data', label: 'Data do recebimento', type: 'date', required: true, value: todayISO() },
  ], {}, vals => {
    const recebido = (Number(r.valorRecebido) || 0) + vals.valor;
    const quitado = recebido >= Number(r.valorAReembolsar) - 0.005;
    update('reimbursements', r.id, {
      valorRecebido: recebido,
      dataRecebimento: vals.data,
      status: quitado ? 'pago' : 'parcial',
    });
    // Reembolso recebido abate a despesa original (não vira receita livre).
    if (quitado && r.expenseId) {
      const exp = db.expenses.find(e => e.id === r.expenseId);
      if (exp && exp.status === 'pago') update('expenses', exp.id, { status: 'reembolsado' });
    }
    toast(quitado ? 'Reembolso quitado e abatido da despesa original.' : 'Recebimento parcial registrado.');
    rerender();
  }, { saveLabel: 'Registrar recebimento' });
}

function novaDespesaReembolsavel(rerender) {
  if (!db.people.length) {
    toast('Cadastre primeiro as pessoas em Configurações.');
    location.hash = '#/config';
    return;
  }
  formModal('Nova despesa reembolsável', fields(), {}, vals => {
    add('reimbursements', { ...vals, valorRecebido: 0, dataSolicitacao: '', dataRecebimento: '' });
    rerender();
  }, { wide: true });
}

// ---- Mensagem para WhatsApp ----
// Por padrão gera a cobrança do MÊS selecionado no app (o cenário mais comum: "quanto
// você me deve em julho?"); um toggle permite trocar para todos os meses pendentes.
function messageModal(pessoa, ymPadrao) {
  const pendentes = db.reimbursements
    .filter(r => r.pessoaId === pessoa.id && ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status) && reimbPending(r) > 0)
    .sort((a, b) => (reimbMonth(a) || '').localeCompare(reimbMonth(b) || '') || (a.data || '').localeCompare(b.data || ''));

  const montar = escopo => {
    const items = escopo === 'mes' ? pendentes.filter(r => reimbMonth(r) === ymPadrao) : pendentes;
    const total = sum(items, reimbPending);
    const rotuloMes = escopo === 'mes' ? ` de ${ymLabel(ymPadrao)}` : '';
    const resumida = total > 0
      ? `Oi! Fechando aqui os valores pendentes${rotuloMes}, ficou ${fmt(total)} para me reembolsar.`
      : `Oi! Não há pendências${rotuloMes} no momento. 🎉`;
    const detalhada = items.length
      ? `${resumida}\n\nDetalhamento:\n${items.map(r => `${fmtDate(r.data)}, ${r.descricao}: ${fmt(reimbPending(r))}`).join('\n')}\n\nTotal: ${fmt(total)}.`
      : resumida;
    return { items, total, resumida, detalhada };
  };

  let escopo = 'mes';
  let modo = 'resumida';
  const atual = () => montar(escopo);

  const ta = h('textarea', { rows: 10, style: 'width:100%;font-size:13px' }, atual().resumida);
  const linkZap = pessoa.contato ? h('a', {
    class: 'btn btn-secondary', target: '_blank', rel: 'noopener',
    href: `https://wa.me/${String(pessoa.contato).replace(/\D/g, '')}?text=${encodeURIComponent(ta.value)}`,
  }, '📱 Abrir no WhatsApp') : null;
  const refresh = () => {
    const { resumida, detalhada } = atual();
    ta.value = modo === 'resumida' ? resumida : detalhada;
    if (linkZap) linkZap.href = `https://wa.me/${String(pessoa.contato).replace(/\D/g, '')}?text=${encodeURIComponent(ta.value)}`;
  };

  const btnMes = h('button', { class: 'btn btn-sm btn-primary', onclick: () => { escopo = 'mes'; refresh(); syncEscopo(); } }, `Este mês (${ymShort(ymPadrao)})`);
  const btnTudo = h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { escopo = 'tudo'; refresh(); syncEscopo(); } }, 'Tudo pendente');
  const syncEscopo = () => {
    btnMes.className = `btn btn-sm ${escopo === 'mes' ? 'btn-primary' : 'btn-ghost'}`;
    btnTudo.className = `btn btn-sm ${escopo === 'tudo' ? 'btn-primary' : 'btn-ghost'}`;
  };

  const btnR = h('button', { class: 'btn btn-sm btn-primary', onclick: () => { modo = 'resumida'; refresh(); syncModo(); } }, 'Resumida');
  const btnD = h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { modo = 'detalhada'; refresh(); syncModo(); } }, 'Detalhada');
  const syncModo = () => {
    btnR.className = `btn btn-sm ${modo === 'resumida' ? 'btn-primary' : 'btn-ghost'}`;
    btnD.className = `btn btn-sm ${modo === 'detalhada' ? 'btn-primary' : 'btn-ghost'}`;
  };

  const overlay = modal(`Mensagem para ${pessoa.nome}`, h('div', {},
    h('div', { style: 'display:flex;gap:8px;margin-bottom:6px' }, btnMes, btnTudo),
    h('div', { style: 'display:flex;gap:8px;margin-bottom:10px' }, btnR, btnD),
    ta,
    h('div', { class: 'modal-actions' },
      linkZap,
      h('button', { class: 'btn btn-primary', onclick: () => {
        navigator.clipboard.writeText(ta.value).then(() => toast('Mensagem copiada.'));
      } }, '📋 Copiar mensagem'))));
}
