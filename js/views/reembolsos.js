// Reembolsos: uma única tabela (parcelados + avulsos) com filtros, resumo por pessoa
// clicável, provisão futura em gráfico e mensagem para WhatsApp.
import { h, fmt, fmtDate, todayISO, sum, ymShort, ymLabel, ymAdd } from '../utils.js';
import { db, ui, add, update, remove, save, STATUS_REEMBOLSO, CRITERIOS_DIVISAO, FORMAS_PAGAMENTO } from '../store.js';
import { reimbPending, reimbOutstanding, reimbMonth } from '../calc.js';
import { ensureReimbursementSync } from './cartoes.js';
import { card, table, badge, formModal, confirmModal, modal, rowActionsMenu, statCard, heroStat, toast } from '../ui.js';
import { bars, CHART_COLORS } from '../charts.js';
import * as sync from '../sync.js';

// Parcela X/Y correspondente a um reembolso ligado a uma compra do cartão (ou '—' se avulso).
function parcelaLabel(r) {
  if (!r.purchaseId || !r.mes) return '—';
  const i = db.installments.find(x => x.purchaseId === r.purchaseId && x.mes === r.mes);
  return i ? `${i.numero}/${i.total}` : '—';
}

// Monta o grupo completo de um parcelamento (todos os meses, independente do mês selecionado)
// — usado no "Ver parcelamento" para responder "quando termina" sem precisar de uma tabela à parte.
function buildGroup(purchaseId) {
  const items = db.reimbursements
    .filter(r => r.purchaseId === purchaseId && r.status !== 'cancelado')
    .sort((a, b) => (a.mes || '').localeCompare(b.mes || ''));
  if (!items.length) return null;
  const purchase = db.purchases.find(p => p.id === purchaseId);
  const installmentsOf = db.installments.filter(i => i.purchaseId === purchaseId).sort((a, b) => a.numero - b.numero);
  return {
    purchaseId, items,
    pessoa: db.people.find(p => p.id === items[0]?.pessoaId),
    descricao: purchase?.descricao || items[0]?.descricao || '—',
    totalAReembolsar: sum(items, r => r.valorAReembolsar),
    totalRecebido: sum(items, r => r.valorRecebido),
    totalPendente: sum(items, reimbPending),
    terminaEm: installmentsOf.length ? installmentsOf[installmentsOf.length - 1].mes : items[items.length - 1]?.mes,
  };
}

// Detalhamento mês a mês de um parcelamento específico, com as mesmas ações da lista geral
// (solicitar, receber, editar, excluir) — atualiza a si mesmo sem precisar fechar o modal.
function detalhamentoModal(purchaseId, rerenderPage) {
  const body = h('div', {});
  const purchase = db.purchases.find(p => p.id === purchaseId);
  const overlay = modal(`Detalhamento — ${purchase?.descricao || ''}`, body);

  function refresh() {
    const group = buildGroup(purchaseId);
    if (!group) { overlay.remove(); rerenderPage(); return; }
    body.innerHTML = '';
    body.append(
      h('p', { class: 'stat-sub' },
        `${group.pessoa?.nome || 'Pessoa não definida'} · total do parcelamento: ${fmt(group.totalAReembolsar)} · já recebido: ${fmt(group.totalRecebido)} · termina em ${group.terminaEm ? ymLabel(group.terminaEm) : '—'}`),
      table([
        { label: 'Mês', render: r => h(r.mes === ui.month ? 'b' : 'span', {}, ymShort(r.mes)) },
        { label: 'Parcela', render: r => parcelaLabel(r) },
        { label: 'Valor', k: 'valorAReembolsar', money: true },
        { label: 'Recebido', k: 'valorRecebido', money: true },
        { label: 'Pendente', render: r => fmt(reimbPending(r)), right: true },
        { label: 'Status', render: r => badge(r.status) },
        { label: '', render: r => actions(r, () => { refresh(); rerenderPage(); }), right: true },
      ], group.items));
  }
  refresh();
}

// Provisão de reembolsos futuros: gráfico compacto por mês (não mais uma tabela sempre
// aberta), com a tabela completa disponível sob demanda.
function renderProvisaoFutura(ym) {
  const horizon = 6;
  const ativos = db.reimbursements.filter(r => r.status !== 'cancelado');
  const meses = Array.from({ length: horizon }, (_, i) => ymAdd(ym, i));
  const rows = meses.map(mes => {
    const itens = ativos.filter(r => reimbMonth(r) === mes && reimbPending(r) > 0);
    return { mes, total: sum(itens, reimbPending), count: itens.length };
  });
  const semNada = rows.every(r => r.total <= 0);
  return card('Provisão de reembolsos futuros',
    h('p', { class: 'stat-sub', style: 'margin-top:-4px' },
      'Quanto ainda está em aberto, mês a mês, somando parcelamentos e avulsos já cadastrados — útil para planejar os próximos meses.'),
    semNada ? h('div', { class: 'empty-state' }, 'Nada em aberto nos próximos meses.') : h('div', {},
      bars(rows.map(r => ymShort(r.mes)), [{ name: 'Pendente', color: CHART_COLORS[1], values: rows.map(r => r.total) }], { height: 160 }),
      h('details', { class: 'card-details' },
        h('summary', {}, 'Ver tabela completa'),
        table([
          { label: 'Mês', render: r => h(r.mes === ym ? 'b' : 'span', {}, ymLabel(r.mes)) },
          { label: 'Itens em aberto', render: r => String(r.count) },
          { label: 'Total pendente', render: r => h(r.total > 0 ? 'b' : 'span', {}, fmt(r.total)), right: true },
        ], rows))));
}

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
    { k: 'criterio', label: 'Critério de divisão', type: 'select', options: CRITERIOS_DIVISAO, value: 'percentual', required: true,
      onchange: v => recalc(v) },
    { k: 'percentual', label: 'Percentual (%)', type: 'number', min: 0, max: 100,
      show: v => v.criterio === 'percentual',
      chips: [['100% (integral)', 100], ['50% (dividir igual)', 50]],
      help: 'Aplicado sobre o valor total da despesa.',
      onchange: v => recalc(v) },
    { k: 'valorAReembolsar', label: 'Valor a reembolsar (R$)', type: 'money', required: true,
      help: 'Calculado automaticamente pelo critério acima — ajuste aqui só se precisar de um valor diferente.' },
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

// ---- Filtro da tabela unificada (não persistido): pessoa, status e mês ----
const filtro = { pessoaId: '', status: '', mes: '' };

export function render(el, rerender) {
  ensureReimbursementSync();
  const ym = ui.month;
  const ativos = db.reimbursements.filter(r => !['cancelado'].includes(r.status));
  const doMes = ativos.filter(r => reimbMonth(r) === ym);

  // ---- Total geral em destaque (item mais consultado) ----
  el.append(heroStat('Total a receber (todos os meses)', reimbOutstanding()));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard(`Pendente em ${ymLabel(ym)}`, sum(doMes, reimbPending), { tone: sum(doMes, reimbPending) > 0 ? 'tone-warn' : 'tone-ok' }),
    statCard('Solicitados', sum(ativos.filter(r => r.status === 'solicitado'), reimbPending)),
    statCard('Recebido no total', sum(db.reimbursements, r => r.valorRecebido), { tone: 'tone-ok' })));

  // Resumo por pessoa, priorizando o mês selecionado (dá pra ver quanto cada um deve NESTE mês).
  const porPessoa = db.people.map(p => {
    const items = ativos.filter(r => r.pessoaId === p.id);
    const itemsMes = items.filter(r => reimbMonth(r) === ym);
    const pendentes = items.filter(r => ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status) && reimbPending(r) > 0);
    return {
      pessoa: p,
      doMes: sum(itemsMes, reimbPending),
      countMes: itemsMes.length,
      pendente: sum(items.filter(r => ['pendente', 'atrasado'].includes(r.status)), reimbPending),
      solicitado: sum(items.filter(r => r.status === 'solicitado'), reimbPending),
      total: sum(items.filter(r => ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status)), reimbPending),
      // Mês mais distante ainda em aberto — dá contexto de escala quando o total geral é
      // muito maior que o devido neste mês (ex.: um parcelamento longo se estendendo).
      ultimoMes: pendentes.map(reimbMonth).filter(Boolean).sort().pop() || '',
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
    h('p', { class: 'stat-sub', style: 'margin-top:-4px' }, 'Clique numa pessoa para filtrar a tabela de reembolsos abaixo só com os itens dela.'),
    table([
      { label: 'Pessoa', render: x => h('a', {
          href: '#', onclick: e => { e.preventDefault(); filtro.pessoaId = x.pessoa.id; rerender(); },
        }, h('b', {}, x.pessoa.nome)) },
      { label: `Deve em ${ymShort(ym)}`, render: x => h('b', {}, fmt(x.doMes)), right: true },
      { label: 'Total pendente (todos os meses)', render: x => {
          // Total bem maior que o devido neste mês, sem contexto, é fácil de estranhar —
          // um aviso com até quando isso se estende ajuda a entender a escala.
          const desproporcional = x.ultimoMes && (x.doMes === 0 ? x.total > 0 : x.total / x.doMes > 3);
          return h('span', {},
            fmt(x.total),
            desproporcional ? h('span', { class: 'stat-sub', style: 'display:block;white-space:nowrap' },
              `⚠️ até ${ymShort(x.ultimoMes)}`) : null);
        }, right: true },
      { label: 'Última solicitação', render: x => x.ultimaSolicitacao ? fmtDate(x.ultimaSolicitacao) : '—' },
      { label: '', render: x => h('div', { style: 'display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => shareLinkModal(x.pessoa) }, '🔗 Link'),
          h('button', { class: 'btn btn-secondary btn-sm', onclick: () => messageModal(x.pessoa, ym) }, '💬 Gerar mensagem')), right: true },
    ], porPessoa, { empty: 'Nenhum reembolso registrado. Marque despesas ou compras do cartão como reembolsáveis, ou cadastre aqui direto.' })));

  el.append(renderTabelaUnificada(ativos, rerender));
  el.append(renderProvisaoFutura(ym));
}

// Uma única tabela com parcelados e avulsos juntos (coluna Tipo distingue), com filtros
// por pessoa, status e mês — em vez de duas tabelas desconectadas.
function renderTabelaUnificada(ativos, rerender) {
  let list = ativos;
  if (filtro.pessoaId) list = list.filter(r => r.pessoaId === filtro.pessoaId);
  if (filtro.status) list = list.filter(r => r.status === filtro.status);
  if (filtro.mes) list = list.filter(r => reimbMonth(r) === filtro.mes);
  list = [...list].sort((a, b) => (reimbMonth(b) || '').localeCompare(reimbMonth(a) || ''));

  const mesesDisponiveis = [...new Set(ativos.map(reimbMonth))].filter(Boolean).sort();

  const sel = (k, opts, label) => h('select', { onchange: e => { filtro[k] = e.target.value; rerender(); } },
    h('option', { value: '' }, label),
    opts.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: filtro[k] === v }, l);
    }));

  const pessoaAtiva = filtro.pessoaId ? db.people.find(p => p.id === filtro.pessoaId) : null;
  const temFiltro = filtro.pessoaId || filtro.status || filtro.mes;

  return card(null,
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Todos os reembolsos')),
    h('div', { class: 'filters' },
      sel('pessoaId', db.people.map(p => [p.id, p.nome]), 'Todas as pessoas'),
      sel('status', STATUS_REEMBOLSO, 'Todos os status'),
      sel('mes', mesesDisponiveis.map(m => [m, ymLabel(m)]), 'Todos os meses'),
      temFiltro ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { filtro.pessoaId = ''; filtro.status = ''; filtro.mes = ''; rerender(); } }, '✕ Limpar filtros') : null),
    pessoaAtiva ? h('div', { style: 'margin-bottom:14px' },
      statCard(`Pendente de ${pessoaAtiva.nome}`, sum(list, reimbPending), {
        tone: 'tone-warn', sub: `${list.length} item(ns) neste filtro`,
      })) : null,
    table([
      { label: 'Tipo', render: r => h('span', { class: `badge ${r.purchaseId ? 'badge-info' : 'badge-muted'}` }, r.purchaseId ? 'Parcelado' : 'Avulso') },
      { label: 'Mês', render: r => h(reimbMonth(r) === ui.month ? 'b' : 'span', {}, ymShort(reimbMonth(r))) },
      { label: 'Parcela', render: r => parcelaLabel(r) },
      { label: 'Descrição', k: 'descricao' },
      ...(filtro.pessoaId ? [] : [{ label: 'Pessoa', render: r => db.people.find(p => p.id === r.pessoaId)?.nome || '—' }]),
      { label: 'A reembolsar', k: 'valorAReembolsar', money: true },
      { label: 'Recebido', k: 'valorRecebido', money: true },
      { label: 'Pendente', render: r => h(reimbPending(r) > 0 ? 'b' : 'span', {}, fmt(reimbPending(r))), right: true },
      { label: 'Status', render: r => badge(r.status) },
      { label: '', render: r => actions(r, rerender), right: true },
    ], list, { empty: ativos.length ? 'Nada encontrado para esse filtro.' : 'Nenhum reembolso registrado.', responsive: true }));
}

// Editar e excluir ficam sempre visíveis (as ações mais usadas); o resto — ver
// parcelamento, marcar como solicitado, registrar recebimento — vai atrás do menu "⋮",
// pra não poluir a linha com muitos ícones de uma vez.
function actions(r, rerender) {
  const overflow = [];
  if (r.purchaseId) overflow.push(['📋', () => detalhamentoModal(r.purchaseId, rerender), 'Ver parcelamento completo']);
  if (['pendente', 'atrasado'].includes(r.status)) {
    overflow.push(['📨', () => { update('reimbursements', r.id, { status: 'solicitado', dataSolicitacao: todayISO() }); toast('Marcado como solicitado.'); rerender(); }, 'Marcar como solicitado']);
  }
  if (reimbPending(r) > 0 && !['cancelado', 'contestado'].includes(r.status)) {
    overflow.push(['💵', () => receberModal(r, rerender), 'Registrar recebimento']);
  }
  const direct = [
    ['✏️', () => formModal('Editar reembolso', fields(), r, vals => { update('reimbursements', r.id, vals); rerender(); }, { wide: true }), 'Editar'],
    ['🗑', () => confirmModal(`Excluir o reembolso "${r.descricao}"?`, () => { remove('reimbursements', r.id); rerender(); }), 'Excluir'],
  ];
  return rowActionsMenu(direct, overflow);
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

// ---- Link compartilhável só-leitura (sem login) de reembolsos pendentes de uma pessoa ----
// Aponta para reembolso.html — uma página separada e isolada do resto do app (não importa
// store.js/app.js), que busca os dados via uma função pública no Supabase (get_reembolsos_
// publicos) sem nunca ter acesso a mais nada: nem outras pessoas, nem despesas gerais.
async function shareLinkModal(pessoa) {
  if (!sync.isLoggedIn()) {
    toast('Configure a sincronização em Configurações antes de gerar um link — ele depende da nuvem para funcionar.');
    return;
  }
  const body = h('div', {}, h('p', { class: 'stat-sub' }, 'Carregando…'));
  const overlay = modal(`Link para ${pessoa.nome}`, body);

  let existing = null;
  try {
    const links = await sync.listShareLinks();
    existing = links.find(l => l.pessoa_id === pessoa.id) || null;
  } catch (e) {
    body.innerHTML = '';
    body.append(h('p', { class: 'form-error' }, `Não foi possível carregar: ${e.message}. Confira se o script supabase/reembolso_links.sql já foi executado no seu projeto Supabase.`));
    return;
  }

  function renderBody() {
    body.innerHTML = '';
    if (existing) {
      const url = sync.shareLinkUrl(existing.token);
      body.append(
        h('p', { class: 'stat-sub' },
          `Qualquer pessoa com este link vê só os itens pendentes de ${pessoa.nome} e o total — sem login, sem ver mais nada do app. Atualiza sozinho conforme você marca coisas como recebidas.`),
        h('input', { type: 'text', readonly: true, value: url, onclick: e => e.target.select() }),
        h('div', { class: 'modal-actions', style: 'justify-content:space-between' },
          h('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
            await sync.deleteShareLink(existing.token).catch(e => toast('Erro ao revogar: ' + e.message));
            existing = null;
            renderBody();
            toast('Link revogado — quem tinha o link antigo não vê mais nada.');
          } }, '🗑 Revogar link'),
          h('button', { class: 'btn btn-primary', onclick: () => {
            navigator.clipboard.writeText(url).then(() => toast('Link copiado.'));
          } }, '📋 Copiar link')));
    } else {
      body.append(
        h('p', { class: 'stat-sub' }, `Gera um link só-leitura mostrando apenas os itens pendentes de ${pessoa.nome}, sem precisar de login — dá pra mandar direto pelo WhatsApp.`),
        h('button', { class: 'btn btn-primary', onclick: async e => {
          e.target.disabled = true;
          try {
            const token = await sync.createShareLink(pessoa.id);
            existing = { token, pessoa_id: pessoa.id };
            renderBody();
          } catch (err) {
            toast('Não foi possível gerar o link: ' + err.message);
            e.target.disabled = false;
          }
        } }, '🔗 Gerar link'));
    }
  }
  renderBody();
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
