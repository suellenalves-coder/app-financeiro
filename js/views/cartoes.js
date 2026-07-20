// Cartões, compras parceladas, faturas, mapa de parcelas futuras e importação em massa.
import { h, fmt, todayISO, ymNow, ymAdd, ymDiff, ymShort, ymLabel, dateInMonth, sum, uid, parseTable, parseMoney, parseYm } from '../utils.js';
import { db, ui, add, update, remove, removeWhere, save } from '../store.js';
import { monthInstallments, cardInvoice, futureInstallmentsTotal, monthSummary } from '../calc.js';
import { card, table, badge, formModal, confirmModal, modal, rowActions, statCard, toast } from '../ui.js';

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

function purchaseFields() {
  return [
    { k: 'descricao', label: 'Descrição', type: 'text', required: true, full: true },
    { k: 'dataCompra', label: 'Data da compra', type: 'date', value: todayISO() },
    { k: 'categoria', label: 'Categoria', type: 'select', options: db.categoriesExpense.map(c => c.nome) },
    { k: 'valorTotal', label: 'Valor total (R$)', type: 'money',
      onchange: v => {
        if (v.valorTotal && v.numParcelas && !v._vpManual) v.valorParcela = +(v.valorTotal / v.numParcelas).toFixed(2);
        if (v.reembolsavel && !v._vrManual) v.valorReembolsavel = v.valorTotal;
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
      onchange: v => { if (v.reembolsavel && !v.valorReembolsavel) v.valorReembolsavel = v.valorTotal || ''; } },
    { k: 'responsavel', label: 'Responsável pelo pagamento', type: 'text', show: v => !v.reembolsavel,
      help: 'Some vazio quando a compra é reembolsável — a pessoa já é definida abaixo.' },
    { k: 'pessoaId', label: 'Pessoa que vai reembolsar', type: 'select',
      options: db.people.map(p => [p.id, p.nome]), show: v => v.reembolsavel,
      help: db.people.length ? '' : 'Cadastre pessoas em Configurações.' },
    { k: 'valorReembolsavel', label: 'Valor a reembolsar (R$)', type: 'money', show: v => v.reembolsavel,
      help: 'Divide automaticamente pelo número de parcelas: cada mês vira um reembolso separado em Reembolsos.',
      onchange: v => { v._vrManual = true; } },
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

  const card = db.cards.find(c => c.id === purchase.cartaoId);
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
        descricao: purchase.descricao, data: dateInMonth(p.mes, Number(card?.diaVencimento) || 1),
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

export function render(el, rerender) {
  const ym = ui.month;
  ensureReimbursementSync();

  if (!db.cards.length) {
    el.append(card('Comece cadastrando um cartão',
      h('p', { class: 'stat-sub' }, 'Cadastre seus cartões de crédito para acompanhar faturas e distribuir parcelas automaticamente.'),
      h('button', { class: 'btn btn-primary', onclick: () => addCard(rerender) }, '+ Cadastrar cartão')));
  }

  // ---- Faturas por cartão no mês ----
  for (const c of db.cards.filter(c => c.ativo !== false)) {
    const inv = cardInvoice(c.id, ym);
    const pct = c.limitePlanejado > 0 ? inv.total / c.limitePlanejado * 100 : 0;
    const meterColor = pct > 100 ? '#E57373' : pct > 80 ? '#F6C667' : '#7BC99A';
    el.append(card(null,
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-title' }, `💳 ${c.nome} · fatura de ${ymLabel(ym)}`),
        rowActions(
          ['✏️', () => editCard(c, rerender), 'Editar cartão'],
          ['🗑', () => confirmModal(`Excluir o cartão "${c.nome}"? As compras e parcelas vinculadas também serão excluídas.`, () => {
            const idsCompras = db.purchases.filter(p => p.cartaoId === c.id).map(p => p.id);
            removeWhere('reimbursements', r => idsCompras.includes(r.purchaseId) && ['pendente', 'solicitado'].includes(r.status));
            removeWhere('purchases', p => p.cartaoId === c.id);
            removeWhere('installments', p => p.cartaoId === c.id);
            remove('cards', c.id);
            rerender();
          }), 'Excluir cartão'])),
      h('div', { class: 'grid grid-cards' },
        statCard('Fatura prevista', inv.total, { sub: c.limitePlanejado ? `limite planejado: ${fmt(c.limitePlanejado)}` : '' }),
        statCard('Compras novas do mês', inv.novas),
        statCard('Parcelas herdadas', inv.herdadas),
        statCard('Já pago', inv.pago, { tone: 'tone-ok' }),
        statCard('Vencimento', `dia ${c.diaVencimento || '—'}`, { sub: c.diaFechamento ? `fecha dia ${c.diaFechamento}` : '' })),
      c.limitePlanejado > 0 ? h('div', {},
        h('div', { class: 'commit-meter' }, h('div', { style: `width:${Math.min(100, pct)}%;background:${meterColor}` })),
        h('div', { class: 'stat-sub' }, `Sua fatura já atingiu ${pct.toFixed(0)}% do limite planejado para este mês.`)) : null,
      inv.parcelas.length ? h('div', { style: 'margin:10px 0' },
        h('button', {
          class: 'btn btn-sm ' + (inv.parcelas.every(p => p.status === 'pago') ? 'btn-ghost' : 'btn-primary'),
          onclick: () => {
            const todasPagas = inv.parcelas.every(p => p.status === 'pago');
            for (const p of inv.parcelas) update('installments', p.id, { status: todasPagas ? 'previsto' : 'pago' });
            toast(todasPagas ? 'Pagamento da fatura desfeito.' : 'Fatura inteira marcada como paga.');
            rerender();
          },
        }, inv.parcelas.every(p => p.status === 'pago') ? '↩︎ Desfazer pagamento da fatura' : '✔️ Marcar fatura inteira como paga')) : null,
      inv.parcelas.length ? table([
        { label: 'Descrição', render: p => db.purchases.find(x => x.id === p.purchaseId)?.descricao || '—' },
        { label: 'Categoria', render: p => db.purchases.find(x => x.id === p.purchaseId)?.categoria || '—' },
        { label: 'Parcela', render: p => `${p.numero}/${p.total}` },
        { label: 'Valor', k: 'valor', money: true },
        { label: 'Status', render: p => badge(p.status) },
        { label: '', render: p => rowActions(
            [p.status === 'pago' ? '↩︎' : '✔️', () => { update('installments', p.id, { status: p.status === 'pago' ? 'previsto' : 'pago' }); rerender(); }, p.status === 'pago' ? 'Desfazer pagamento' : 'Marcar como paga']), right: true },
      ], inv.parcelas) : h('div', { class: 'empty-state' }, 'Nenhuma parcela neste mês.')));
  }

  // ---- Ações principais ----
  el.append(card(null, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
    h('button', { class: 'btn btn-primary', onclick: () => formModal('Nova compra parcelada', purchaseFields(), {}, vals => {
      savePurchase(vals);
      warnAfterPurchase(vals);
      rerender();
    }, { wide: true }) }, '+ Nova compra parcelada'),
    h('button', { class: 'btn btn-secondary', onclick: () => importModal(rerender) }, '⬆ Importar parcelamentos em massa'),
    h('button', { class: 'btn btn-ghost', onclick: () => addCard(rerender) }, '+ Novo cartão'),
    h('button', { class: 'btn btn-ghost', onclick: () => location.hash = '#/simulador' }, '🧮 Simular nova compra'))));

  // ---- Compras parceladas cadastradas ----
  const purchases = [...db.purchases].sort((a, b) => (b.mesInicio || '').localeCompare(a.mesInicio || ''));
  el.append(card('Compras parceladas cadastradas',
    table([
      { label: 'Descrição', render: p => h('span', {}, p.descricao,
          p.reembolsavel ? h('span', { title: `Reembolsável${p.pessoaId ? ' — ' + (db.people.find(x => x.id === p.pessoaId)?.nome || '') : ''}`, style: 'margin-left:5px' }, '🤝') : null) },
      { label: 'Cartão', render: p => db.cards.find(c => c.id === p.cartaoId)?.nome || '—' },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Parcelas', render: p => `${p.numParcelas}× de ${fmt(p.valorParcela || (p.valorTotal / p.numParcelas))}` },
      { label: 'Início', render: p => ymShort(p.mesInicio) },
      { label: 'Restante', render: p => fmt(sum(db.installments.filter(i => i.purchaseId === p.id && i.status !== 'pago' && ymDiff(i.mes, ym) >= 0), i => i.valor)), right: true },
      { label: '', render: p => rowActions(
          ['✏️', () => formModal('Editar compra parcelada', purchaseFields(), p, vals => { savePurchase(vals, p.id); rerender(); }, { wide: true }), 'Editar'],
          ['🗑', () => confirmModal(`Excluir "${p.descricao}" e todas as suas parcelas?${p.reembolsavel ? ' Os reembolsos vinculados ainda não recebidos também serão removidos.' : ''}`, () => {
            removeWhere('installments', i => i.purchaseId === p.id);
            removeWhere('reimbursements', r => r.purchaseId === p.id && ['pendente', 'solicitado'].includes(r.status));
            remove('purchases', p.id);
            rerender();
          }), 'Excluir']), right: true },
    ], purchases, { empty: 'Nenhuma compra parcelada. Use a importação em massa para carregar as existentes.' })));

  // ---- Mapa de parcelamentos futuros ----
  el.append(renderFutureMap(ym));
}

function renderFutureMap(ym) {
  const horizon = 18;
  const rows = [];
  for (let i = 0; i < horizon; i++) {
    const m = ymAdd(ym, i);
    const parcelas = monthInstallments(m);
    if (!parcelas.length) continue;
    const totalMes = sum(parcelas, p => p.valor);
    for (const p of parcelas) {
      const compra = db.purchases.find(x => x.id === p.purchaseId);
      rows.push({
        mes: ymShort(m), cartao: db.cards.find(c => c.id === p.cartaoId)?.nome || '—',
        descricao: compra?.descricao || '—', parcela: `${p.numero}/${p.total}`,
        valor: p.valor, categoria: compra?.categoria || '—', status: p.status, totalMes,
        _first: p === parcelas[0],
      });
    }
  }
  return card(`Mapa de parcelamentos futuros (${fmt(futureInstallmentsTotal(ymAdd(ym, -1)))} comprometidos a partir de ${ymLabel(ym)})`,
    table([
      { label: 'Mês', render: r => r._first ? h('b', {}, r.mes) : h('span', { style: 'color:var(--ink-2)' }, r.mes) },
      { label: 'Cartão', k: 'cartao' },
      { label: 'Descrição', k: 'descricao' },
      { label: 'Parcela', k: 'parcela' },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Status', render: r => badge(r.status) },
      { label: 'Total do mês', render: r => r._first ? h('b', {}, fmt(r.totalMes)) : '', right: true },
    ], rows, { empty: 'Nenhuma parcela futura cadastrada.' }));
}

// ---- Cadastro de cartões ----
function cardFields() {
  return [
    { k: 'nome', label: 'Nome do cartão', type: 'text', required: true },
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome) },
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
