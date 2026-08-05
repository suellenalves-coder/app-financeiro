// Cartões e compras parceladas: cartões recolhidos por padrão, com abas e busca dentro
// de cada um. O mapa de parcelamentos futuros mora em tela própria (mapaParcelamentos.js).
import { h, fmt, todayISO, ymNow, ymAdd, ymDiff, ymShort, ymLabel, dateInMonth, sum, uid, parseTable, parseMoney, parseYm } from '../utils.js';
import { db, ui, add, update, remove, removeWhere, save, STATUS_DESPESA } from '../store.js';
import { cardInvoice, monthSummary } from '../calc.js';
import { card, table, searchableTable, badge, formModal, confirmModal, modal, rowActions, statCard, toast } from '../ui.js';
import { fields as despesaFields, saveExpense } from './despesas.js';

const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outra'];

// ---- Geração de parcelas de uma compra ----
export function generateInstallments(purchase) {
  const total = Number(purchase.numParcelas) || 1;
  const inicial = Number(purchase.parcelaInicial) || 1;
  const valor = Number(purchase.valorParcela) || (Number(purchase.valorTotal) || 0) / total;
  const out = [];
  for (let n = inicial; n <= total; n++) {
    out.push({
      id: uid(),
      purchaseId: purchase.id,
      cartaoId: purchase.cartaoId,
      numero: n,
      total,
      parcelaInicial: inicial,
      valor,
      mes: ymAdd(purchase.mesInicio, n - inicial),
      status: 'previsto',
    });
  }
  return out;
}

// Recalcula o valor a reembolsar (R$) a partir do percentual × valor total — usado nos
// onchange de valorTotal, reembolsavel e percentualReembolso, pra manter os três em sincronia.
function aplicarPercentualReembolso(v) {
  v.valorReembolsavel = +((Number(v.valorTotal) || 0) * (Number(v.percentualReembolso) || 0) / 100).toFixed(2);
}

// existing: compra sendo editada (ou {} para uma nova), só pra pré-preencher o percentual
// de registros antigos que só tinham o valor fixo em R$ salvo (compatibilidade).
function purchaseFields(existing = {}) {
  const percentualPadrao = existing.percentualReembolso ??
    (Number(existing.valorTotal) > 0 && Number(existing.valorReembolsavel) > 0
      ? +(Number(existing.valorReembolsavel) / Number(existing.valorTotal) * 100).toFixed(1) : 100);
  return [
    { k: 'descricao', label: 'Descrição', type: 'text', required: true, full: true },
    { k: 'dataCompra', label: 'Data da compra', type: 'date', value: todayISO() },
    { k: 'categoria', label: 'Categoria', type: 'select', options: db.categoriesExpense.map(c => c.nome) },
    { k: 'valorTotal', label: 'Valor total (R$)', type: 'money',
      onchange: v => {
        if (v.valorTotal && v.numParcelas && !v._vpManual) v.valorParcela = +(v.valorTotal / v.numParcelas).toFixed(2);
        if (v.reembolsavel) aplicarPercentualReembolso(v);
      } },
    { k: 'numParcelas', label: 'Quantidade de parcelas', type: 'number', required: true, min: 1, value: 1,
      onchange: v => { if (v.valorTotal && v.numParcelas && !v._vpManual) v.valorParcela = +(v.valorTotal / v.numParcelas).toFixed(2); } },
    { k: 'parcelaInicial', label: 'Número da parcela inicial', type: 'number', min: 1, value: 1,
      help: 'Use > 1 para compras antigas já parcialmente pagas.' },
    { k: 'valorParcela', label: 'Valor da parcela (R$)', type: 'money', required: true,
      onchange: v => { v._vpManual = true; } },
    { k: 'cartaoId', label: 'Cartão', type: 'select', options: db.cards.map(c => [c.id, c.nome]), required: true },
    { k: 'mesInicio', label: 'Mês de início da cobrança', type: 'month', required: true, value: ymNow() },
    { k: 'reembolsavel', label: 'Compra reembolsável / para outra pessoa', type: 'check',
      onchange: v => {
        if (v.reembolsavel && !v.percentualReembolso) v.percentualReembolso = percentualPadrao;
        if (v.reembolsavel) aplicarPercentualReembolso(v);
      } },
    { k: 'responsavel', label: 'Responsável pelo pagamento', type: 'text', show: v => !v.reembolsavel,
      help: 'Some vazio quando a compra é reembolsável — a pessoa já é definida abaixo.' },
    { k: 'pessoaId', label: 'Pessoa que vai reembolsar', type: 'select',
      options: db.people.map(p => [p.id, p.nome]), show: v => v.reembolsavel,
      help: db.people.length ? '' : 'Cadastre pessoas em Configurações.' },
    { k: 'percentualReembolso', label: 'Percentual a reembolsar (%)', type: 'number', min: 0, max: 100, step: 1,
      show: v => v.reembolsavel, value: percentualPadrao,
      chips: [['100% (integral)', 100], ['50% (dividir igual)', 50]],
      help: 'Aplicado sobre o valor total da compra. Divide automaticamente pelo número de parcelas: cada mês vira um reembolso separado em Reembolsos.',
      onchange: v => aplicarPercentualReembolso(v) },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

// Ao salvar uma compra reembolsável, cria/atualiza UM REEMBOLSO POR MÊS (por parcela) —
// assim dá pra dizer exatamente quanto a pessoa deve *naquele mês*, sem retrabalho.
// A chave de sincronização é (purchaseId, mês da parcela): estável mesmo quando a compra
// é editada e as parcelas são regeradas com novos ids. Reembolsos já pagos/parciais nunca
// são apagados ou sobrescritos — preserva o histórico de recebimento.
function syncReimbursementsForPurchase(purchase, installments) {
  const existing = db.reimbursements.filter(r => r.purchaseId === purchase.id);
  const querReembolso = purchase.reembolsavel && purchase.pessoaId && Number(purchase.valorReembolsavel) > 0;

  if (!querReembolso) {
    for (const r of existing) if (['pendente', 'solicitado'].includes(r.status)) removeWhere('reimbursements', x => x.id === r.id);
    return;
  }

  // Migração de dados antigos: um reembolso único sem mês definido (de uma versão anterior
  // do app, que não dividia por parcela) é substituído pelos lançamentos mensais corretos,
  // desde que ainda não tenha recebimento registrado.
  for (const r of existing) {
    if (!r.mes && ['pendente', 'solicitado'].includes(r.status)) removeWhere('reimbursements', x => x.id === r.id);
  }
  const restantes = existing.filter(r => r.mes || ['pago', 'parcial'].includes(r.status));

  const cardObj = db.cards.find(c => c.id === purchase.cartaoId);
  const totalParcelas = installments.length || 1;
  const valorPorMes = Number(purchase.valorReembolsavel) / totalParcelas;
  const mesesAtuais = new Set(installments.map(p => p.mes));

  for (const p of installments) {
    const found = restantes.find(r => r.mes === p.mes);
    if (found) {
      if (!['pago', 'parcial'].includes(found.status)) {
        update('reimbursements', found.id, {
          pessoaId: purchase.pessoaId, valorAReembolsar: +valorPorMes.toFixed(2),
          descricao: purchase.descricao, categoria: purchase.categoria, valorTotalDespesa: Number(p.valor),
        });
      }
    } else {
      add('reimbursements', {
        purchaseId: purchase.id, mes: p.mes, pessoaId: purchase.pessoaId,
        descricao: purchase.descricao, data: dateInMonth(p.mes, Number(cardObj?.diaVencimento) || 1),
        categoria: purchase.categoria, valorTotalDespesa: Number(p.valor), criterio: 'fixo', percentual: '',
        valorAReembolsar: +valorPorMes.toFixed(2), valorRecebido: 0,
        status: 'pendente', dataSolicitacao: '', dataRecebimento: '', obs: '',
      });
    }
  }
  // Parcela removida (reduziu o número de parcelas): some o reembolso daquele mês, se ainda não foi pago.
  for (const r of restantes) {
    if (r.mes && !mesesAtuais.has(r.mes) && ['pendente', 'solicitado'].includes(r.status)) {
      removeWhere('reimbursements', x => x.id === r.id);
    }
  }
}

function savePurchase(vals, existingId) {
  let purchase, installments;
  if (existingId) {
    // Regerar parcelas mantendo status pago das já quitadas quando possível
    removeWhere('installments', p => p.purchaseId === existingId);
    purchase = update('purchases', existingId, vals);
    installments = generateInstallments(purchase);
    db.installments.push(...installments);
  } else {
    purchase = add('purchases', vals);
    installments = generateInstallments(purchase);
    db.installments.push(...installments);
  }
  syncReimbursementsForPurchase(purchase, installments);
  save();
}

// Autocorreção: compras reembolsáveis cadastradas antes desta versão (ou nunca reeditadas)
// ainda têm um reembolso único e não dividido por parcela. Chamada sempre que as telas de
// Cartões ou Reembolsos abrem — sincroniza tudo em silêncio, sem exigir reedição manual.
export function ensureReimbursementSync() {
  for (const purchase of db.purchases) {
    if (!purchase.reembolsavel) continue;
    const installments = db.installments.filter(i => i.purchaseId === purchase.id);
    if (!installments.length) continue;
    syncReimbursementsForPurchase(purchase, installments);
  }
}

// Avisos pós-cadastro: a compra deixa algum mês futuro negativo?
function warnAfterPurchase(vals) {
  const meses = Number(vals.numParcelas) - Number(vals.parcelaInicial || 1) + 1;
  for (let i = 0; i < meses; i++) {
    const m = ymAdd(vals.mesInicio, i);
    if (monthSummary(m).saldoLivreReal < 0) {
      toast(`Atenção: ${ymLabel(m)} ficou com saldo livre real negativo com essa compra.`);
      return;
    }
  }
  toast(`Compra parcelada cadastrada: ${meses} parcela(s) de ${fmt(vals.valorParcela)}.`);
}

// ---- Estado de interface (não persistido): quais cartões estão expandidos, aba ativa e
// filtros de busca/status por cartão e por aba. Um Map module-level mantém a mesma
// instância entre re-renders, senão o filtro "esqueceria" a cada rerender global. ----
const cardUi = new Map();
function getCardUi(id) {
  if (!cardUi.has(id)) {
    cardUi.set(id, {
      open: false, tab: 'mes',
      filtroMes: { search: '', status: '' },
      filtroTodas: { search: '', status: '' },
    });
  }
  return cardUi.get(id);
}
const orfasFiltro = { search: '', status: '' };

// Uma compra parcelada não tem UM status (cada parcela tem o seu) — "quitada" quando
// todas as parcelas já foram pagas, "em andamento" caso contrário. Usado pro badge e
// pro filtro de status na aba "Todas as parcelas".
function withStatusCalc(purchases) {
  return purchases.map(p => {
    const parcelasP = db.installments.filter(i => i.purchaseId === p.id);
    const quitada = parcelasP.length > 0 && parcelasP.every(i => i.status === 'pago');
    return { ...p, _statusCalc: quitada ? 'quitada' : 'em_andamento' };
  });
}

function purchaseCols(ym, rerender, { showCartao = false } = {}) {
  return [
    { label: 'Descrição', render: p => h('span', {}, p.descricao,
        p.reembolsavel ? h('span', { title: `Reembolsável${p.pessoaId ? ' — ' + (db.people.find(x => x.id === p.pessoaId)?.nome || '') : ''}`, style: 'margin-left:5px' }, '🤝') : null) },
    showCartao ? { label: 'Cartão', render: p => db.cards.find(c => c.id === p.cartaoId)?.nome || '— (excluído/inativo)' } : null,
    { label: 'Categoria', k: 'categoria' },
    { label: 'Parcelas', render: p => `${p.numParcelas}× de ${fmt(p.valorParcela || (p.valorTotal / p.numParcelas))}` },
    { label: 'Início', render: p => ymShort(p.mesInicio) },
    { label: 'Restante', render: p => fmt(sum(db.installments.filter(i => i.purchaseId === p.id && i.status !== 'pago' && ymDiff(i.mes, ym) >= 0), i => i.valor)), right: true },
    { label: 'Status', render: p => badge(p._statusCalc) },
    { label: '', render: p => rowActions(
        ['✏️', () => formModal('Editar compra parcelada', purchaseFields(p), p, vals => { savePurchase(vals, p.id); rerender(); }, { wide: true }), 'Editar'],
        ['🗑', () => confirmModal(`Excluir "${p.descricao}" e todas as suas parcelas?${p.reembolsavel ? ' Os reembolsos vinculados ainda não recebidos também serão removidos.' : ''}`, () => {
          removeWhere('installments', i => i.purchaseId === p.id);
          removeWhere('reimbursements', r => r.purchaseId === p.id && ['pendente', 'solicitado'].includes(r.status));
          remove('purchases', p.id);
          rerender();
        }), 'Excluir']), right: true },
  ].filter(Boolean);
}

const STATUS_PARCELAMENTO = [['em_andamento', 'Em andamento'], ['quitada', 'Quitada']];

export function render(el, rerender) {
  const ym = ui.month;
  ensureReimbursementSync();

  // ---- Ações principais (fixas no topo, antes de qualquer fatura) ----
  el.append(card(null, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
    h('button', { class: 'btn btn-primary', onclick: () => formModal('Nova compra parcelada', purchaseFields(), {}, vals => {
      savePurchase(vals);
      warnAfterPurchase(vals);
      rerender();
    }, { wide: true }) }, '+ Nova compra parcelada'),
    h('button', { class: 'btn btn-secondary', onclick: () => importModal(rerender) }, '⬆ Importar parcelamentos em massa'),
    h('button', { class: 'btn btn-ghost', onclick: () => addCard(rerender) }, '+ Novo cartão'),
    h('button', { class: 'btn btn-ghost', onclick: () => location.hash = '#/simulador' }, '🧮 Simular nova compra'),
    h('button', { class: 'btn btn-ghost', onclick: () => location.hash = '#/mapa-parcelamentos' }, '🗺️ Mapa de parcelamentos futuros'))));

  if (!db.cards.length) {
    el.append(card('Comece cadastrando um cartão',
      h('p', { class: 'stat-sub' }, 'Cadastre seus cartões de crédito para acompanhar faturas e distribuir parcelas automaticamente.'),
      h('button', { class: 'btn btn-primary', onclick: () => addCard(rerender) }, '+ Cadastrar cartão')));
  }

  // ---- Faturas por cartão no mês: cada cartão inicia recolhido, mostrando só o essencial ----
  const cartoesAtivos = db.cards.filter(c => c.ativo !== false);
  const idsCartoesAtivos = new Set(cartoesAtivos.map(c => c.id));

  if (cartoesAtivos.length > 1) {
    el.append(h('div', { style: 'display:flex;gap:8px;margin:-2px 0 14px' },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { for (const c of cartoesAtivos) getCardUi(c.id).open = false; rerender(); } }, '▸ Recolher tudo'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { for (const c of cartoesAtivos) getCardUi(c.id).open = true; rerender(); } }, '▾ Expandir tudo')));
  }

  for (const c of cartoesAtivos) {
    el.append(renderCartaoCard(c, ym, rerender));
  }

  // ---- Compras sem cartão ativo vinculado (cartão excluído/inativo) ----
  const orfas = db.purchases.filter(p => !idsCartoesAtivos.has(p.cartaoId));
  if (orfas.length) {
    el.append(card('Compras sem cartão ativo vinculado',
      searchableTable(withStatusCalc(orfas), purchaseCols(ym, rerender, { showCartao: true }), orfasFiltro, {
        searchKeys: ['descricao', 'categoria'], statusOptions: STATUS_PARCELAMENTO,
        empty: 'Nenhuma compra sem cartão vinculado.',
      })));
  }
}

// ---- Um cartão: cabeçalho sempre visível (recolhido por padrão) + corpo expansível com abas ----
function renderCartaoCard(c, ym, rerender) {
  const st = getCardUi(c.id);
  const inv = cardInvoice(c.id, ym);
  const pct = c.limitePlanejado > 0 ? inv.total / c.limitePlanejado * 100 : 0;
  const meterColor = pct > 100 ? '#E57373' : pct > 80 ? '#F6C667' : '#7BC99A';
  const nearLimit = c.limitePlanejado > 0 && pct > 80;

  const head = h('div', {
    class: 'collapsible-head',
    onclick: () => { st.open = !st.open; rerender(); },
  },
    h('span', { class: 'collapsible-chevron' }, '▸'),
    h('span', { class: 'collapsible-title' }, `💳 ${c.nome}`),
    c.bandeira ? h('span', { class: 'collapsible-sub' }, c.bandeira) : null,
    nearLimit ? h('span', { class: `badge badge-${pct > 100 ? 'bad' : 'warn'} badge-limite` },
      pct > 100 ? '⚠️ limite estourado' : `⚠️ ${pct.toFixed(0)}% do limite`) : null,
    h('span', { class: 'collapsible-spacer' }),
    h('span', { class: 'collapsible-fatura' }, fmt(inv.total)),
    h('span', { class: 'collapsible-sub' }, `vence dia ${c.diaVencimento || '—'}`),
    c.limitePlanejado > 0 ? h('div', { class: 'collapsible-meter' },
      h('div', { style: `width:${Math.min(100, pct)}%;background:${meterColor}` })) : null,
    h('div', { class: 'collapsible-actions', onclick: e => e.stopPropagation() },
      h('div', { class: 'row-actions' },
        ['🧾', '✏️', '🗑'].map((label, i) => {
          const acts = [
            () => expenseOnCardModal(c, ym, rerender),
            () => editCard(c, rerender),
            () => confirmModal(`Excluir o cartão "${c.nome}"? As compras e parcelas vinculadas também serão excluídas.`, () => {
              const idsCompras = db.purchases.filter(p => p.cartaoId === c.id).map(p => p.id);
              removeWhere('reimbursements', r => idsCompras.includes(r.purchaseId) && ['pendente', 'solicitado'].includes(r.status));
              removeWhere('purchases', p => p.cartaoId === c.id);
              removeWhere('installments', p => p.cartaoId === c.id);
              remove('cards', c.id);
              rerender();
            }),
          ];
          const titles = ['Nova despesa neste cartão', 'Editar cartão', 'Excluir cartão'];
          return h('button', { class: 'icon-btn icon-btn-lg', title: titles[i], onclick: acts[i] }, label);
        }))));

  const wrap = h('div', { class: `card collapsible-card ${st.open ? 'open' : ''}` }, head);
  if (st.open) wrap.append(renderCartaoBody(c, ym, rerender, inv, pct, meterColor, st));
  return wrap;
}

function renderCartaoBody(c, ym, rerender, inv, pct, meterColor, st) {
  const doCartao = db.purchases.filter(p => p.cartaoId === c.id);

  // Linhas da fatura do mês: parcelas de compras parceladas + despesas avulsas pagas
  // neste cartão (ex.: abastecimentos) — tudo num só lugar, cada uma com ação de pagar.
  const linhas = [
    ...inv.parcelas.map(p => ({
      descricao: db.purchases.find(x => x.id === p.purchaseId)?.descricao || '—',
      categoria: db.purchases.find(x => x.id === p.purchaseId)?.categoria || '—',
      parcela: `${p.numero}/${p.total}`, valor: p.valor, status: p.status,
      setStatus: novo => update('installments', p.id, { status: novo }),
    })),
    ...inv.despesas.map(e => ({
      descricao: e.descricao, categoria: e.categoria || '—', parcela: '—',
      valor: e.valorTotal, status: e.status,
      setStatus: novo => update('expenses', e.id, { status: novo }),
    })),
  ];
  const todasPagas = linhas.length > 0 && linhas.every(l => l.status === 'pago');

  const tabs = h('div', { class: 'tabs' },
    h('button', { class: `tab-btn ${st.tab === 'mes' ? 'active' : ''}`, onclick: () => { st.tab = 'mes'; rerender(); } }, `Este mês (${linhas.length})`),
    h('button', { class: `tab-btn ${st.tab === 'todas' ? 'active' : ''}`, onclick: () => { st.tab = 'todas'; rerender(); } }, `Todas as parcelas (${doCartao.length})`));

  const linhasCols = [
    { label: 'Descrição', k: 'descricao' },
    { label: 'Categoria', k: 'categoria' },
    { label: 'Parcela', k: 'parcela' },
    { label: 'Valor', k: 'valor', money: true },
    { label: 'Status', render: l => badge(l.status) },
    { label: '', render: l => rowActions(
        [l.status === 'pago' ? '↩︎' : '✔️', () => { l.setStatus(l.status === 'pago' ? 'previsto' : 'pago'); rerender(); }, l.status === 'pago' ? 'Desfazer pagamento' : 'Marcar como paga']), right: true },
  ];

  const tabMes = h('div', {},
    linhas.length ? h('div', { style: 'margin-bottom:10px' },
      h('button', {
        class: 'btn btn-sm ' + (todasPagas ? 'btn-ghost' : 'btn-primary'),
        onclick: () => {
          const alvo = todasPagas ? 'previsto' : 'pago';
          for (const l of linhas) l.setStatus(alvo);
          toast(todasPagas ? 'Pagamento da fatura desfeito.' : 'Fatura inteira marcada como paga.');
          rerender();
        },
      }, todasPagas ? '↩︎ Desfazer pagamento da fatura' : '✔️ Marcar fatura inteira como paga')) : null,
    searchableTable(linhas, linhasCols, st.filtroMes, {
      searchKeys: ['descricao', 'categoria'], statusOptions: STATUS_DESPESA,
      empty: 'Nenhuma parcela ou despesa neste mês.',
    }));

  const tabTodas = searchableTable(withStatusCalc(doCartao), purchaseCols(ym, rerender), st.filtroTodas, {
    searchKeys: ['descricao', 'categoria'], statusOptions: STATUS_PARCELAMENTO,
    empty: 'Nenhuma compra parcelada. Use a importação em massa para carregar as existentes.',
  });

  return h('div', { class: 'collapsible-body' },
    h('div', { class: 'grid grid-cards' },
      statCard('Fatura prevista', inv.total, { sub: c.limitePlanejado ? `limite planejado: ${fmt(c.limitePlanejado)}` : '' }),
      statCard('Compras novas do mês', inv.novas),
      statCard('Parcelas herdadas', inv.herdadas),
      statCard('Já pago', inv.pago, { tone: 'tone-ok' }),
      statCard('Vencimento', `dia ${c.diaVencimento || '—'}`, { sub: c.diaFechamento ? `fecha dia ${c.diaFechamento}` : '' })),
    c.limitePlanejado > 0 ? h('div', {},
      h('div', { class: 'commit-meter' }, h('div', { style: `width:${Math.min(100, pct)}%;background:${meterColor}` })),
      h('div', { class: 'stat-sub' }, `Sua fatura já atingiu ${pct.toFixed(0)}% do limite planejado para este mês.`)) : null,
    tabs,
    st.tab === 'mes' ? tabMes : tabTodas);
}

// Nova despesa avulsa já pré-vinculada a este cartão (mesmo cadastro de Despesas,
// sem precisar trocar de tela nem selecionar o cartão/forma de pagamento na mão).
function expenseOnCardModal(c, ym, rerender) {
  const initial = {
    cartaoId: c.id, formaPagamento: 'Cartão de crédito',
    dataCompra: dateInMonth(ym, new Date().getDate()), status: 'previsto',
  };
  formModal(`Nova despesa — ${c.nome}`, despesaFields(), initial, vals => {
    saveExpense(vals);
    toast('Despesa cadastrada.');
    rerender();
  }, { wide: true });
}

// ---- Cadastro de cartões ----
function cardFields() {
  return [
    { k: 'nome', label: 'Nome do cartão', type: 'text', required: true },
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome) },
    { k: 'bandeira', label: 'Bandeira', type: 'select', options: BANDEIRAS },
    { k: 'diaFechamento', label: 'Dia de fechamento', type: 'number', min: 1, max: 31 },
    { k: 'diaVencimento', label: 'Dia de vencimento', type: 'number', min: 1, max: 31 },
    { k: 'limitePlanejado', label: 'Limite planejado mensal (R$)', type: 'money', help: 'Quanto você quer gastar no máximo por fatura.' },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}
export function addCard(rerender) {
  formModal('Novo cartão', cardFields(), {}, vals => { add('cards', { ...vals, ativo: true }); rerender(); });
}
function editCard(c, rerender) {
  formModal('Editar cartão', cardFields(), c, vals => { update('cards', c.id, vals); rerender(); });
}

// ---- Importação em massa ----
const IMPORT_HEADERS = 'descricao;categoria;cartao;valor_parcela;parcela_atual;total_parcelas;mes_inicial;valor_total;responsavel;observacoes';
const EXAMPLE = 'Notebook;Casa;Nubank;250,00;3;10;08/2026;2500,00;Suellen;compra da Magalu';

function importModal(rerender) {
  const ta = h('textarea', {
    rows: 8, style: 'width:100%;font-family:monospace;font-size:12px',
    placeholder: `${IMPORT_HEADERS}\n${EXAMPLE}`,
  });
  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,.tsv' });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) f.text().then(t => { ta.value = t; });
  });
  const result = h('div', { class: 'stat-sub', style: 'margin-top:8px' });

  const overlay = modal('Importar parcelamentos em massa', h('div', {},
    h('p', { class: 'stat-sub' },
      'Cole a tabela (do Excel, Google Sheets ou CSV) ou envie um arquivo. A primeira linha deve conter os cabeçalhos. Separadores aceitos: ponto e vírgula, vírgula ou tabulação.'),
    h('p', { class: 'stat-sub' }, 'Colunas reconhecidas: ', h('code', {}, IMPORT_HEADERS.replaceAll(';', ' · '))),
    fileInput, h('div', { style: 'height:8px' }), ta, result,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', onclick: () => overlay.remove() }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: () => {
        const res = importRows(ta.value);
        if (res.error) { result.textContent = res.error; result.style.color = 'var(--erro)'; return; }
        overlay.remove();
        toast(`${res.count} parcelamento(s) importado(s) e somado(s) à coleção existente.`);
        rerender();
      } }, 'Importar'))), { wide: true });
}

function importRows(text) {
  const { rows } = parseTable(text);
  if (!rows.length) return { error: 'Nenhuma linha encontrada. Cole os dados com a linha de cabeçalho.' };
  const col = (r, ...names) => {
    for (const n of names) {
      const key = Object.keys(r).find(k => k.replace(/[\s_-]/g, '') === n.replace(/[\s_-]/g, ''));
      if (key && r[key] !== '') return r[key];
    }
    return '';
  };
  let count = 0;
  const errors = [];
  rows.forEach((r, idx) => {
    const descricao = col(r, 'descricao', 'descrição', 'item');
    const valorParcela = parseMoney(col(r, 'valor_parcela', 'valor da parcela', 'parcela_valor', 'valor'));
    const totalParcelas = parseInt(col(r, 'total_parcelas', 'total de parcelas', 'parcelas', 'qtd_parcelas')) || 1;
    const parcelaAtual = parseInt(col(r, 'parcela_atual', 'parcela atual', 'parcela')) || 1;
    const mesInicial = parseYm(col(r, 'mes_inicial', 'mês inicial', 'mes_inicio', 'inicio')) || ymNow();
    if (!descricao || !valorParcela) { errors.push(idx + 2); return; }
    const cartaoNome = col(r, 'cartao', 'cartão');
    let cartao = db.cards.find(c => c.nome.toLowerCase() === cartaoNome.toLowerCase());
    if (!cartao && cartaoNome) cartao = add('cards', { nome: cartaoNome, banco: '', limitePlanejado: 0, ativo: true });
    const purchase = add('purchases', {
      descricao,
      dataCompra: todayISO(),
      categoria: col(r, 'categoria') || 'Outros',
      valorTotal: parseMoney(col(r, 'valor_total', 'valor total')) || valorParcela * totalParcelas,
      numParcelas: totalParcelas,
      parcelaInicial: parcelaAtual,
      valorParcela,
      cartaoId: cartao?.id || '',
      mesInicio: mesInicial,
      responsavel: col(r, 'responsavel', 'responsável'),
      reembolsavel: false,
      obs: col(r, 'observacoes', 'observações', 'obs') + ' (importado em massa)',
    });
    db.installments.push(...generateInstallments(purchase));
    count++;
  });
  save();
  if (!count) return { error: `Nenhuma linha válida. Verifique descrição e valor da parcela (linhas: ${errors.join(', ')}).` };
  return { count };
}
