// Módulo do carro: custos consolidados de todas as despesas ligadas ao carro + abastecimentos.
import { h, fmt, fmtDate, todayISO, ymShort, ymAdd, ymOf, sum } from '../utils.js';
import { db, ui, add, update, remove, save, CATEGORIAS_CARRO, FORMAS_PAGAMENTO } from '../store.js';
import { monthExpenses, recurringOccurrences, monthInstallments, expenseNet, installmentNet, provisionMonthly, carFuelStats } from '../calc.js';
import { card, statCard, table, badge, formModal, confirmModal, rowActions, toast } from '../ui.js';
import { bars, donut, CHART_COLORS } from '../charts.js';

const SUBCATS = ['Financiamento', 'Combustível', 'Seguro', 'Manutenção', 'Revisão', 'IPVA', 'Estacionamento', 'Lavagem', 'Multas', 'Outros'];

function isCarro(categoria) {
  return CATEGORIAS_CARRO.includes(categoria);
}

// Todas as despesas do carro em um mês (avulsas + recorrentes + parcelas).
// Despesas geradas por um abastecimento não entram aqui — já aparecem, com mais detalhe
// (km, litros, preço/L), na tabela dedicada de Abastecimentos.
function carItems(ym) {
  const out = [];
  const idsDeAbastecimento = new Set(db.refuelings.map(r => r.expenseId).filter(Boolean));
  for (const e of monthExpenses(ym).filter(e => isCarro(e.categoria) && !idsDeAbastecimento.has(e.id))) {
    out.push({ data: e.dataVencimento || e.dataCompra, descricao: e.descricao, sub: e.subcategoria || e.categoria, valor: expenseNet(e), status: e.status });
  }
  for (const o of recurringOccurrences(ym).filter(o => isCarro(o.categoria))) {
    out.push({ data: o.dataVencimento, descricao: o.nome, sub: o.categoria, valor: o.valor, status: o.status });
  }
  for (const p of monthInstallments(ym)) {
    const compra = db.purchases.find(c => c.id === p.purchaseId);
    if (compra && isCarro(compra.categoria)) {
      out.push({ data: `${p.mes}-01`, descricao: `${compra.descricao} (${p.numero}/${p.total})`, sub: compra.subcategoria || compra.categoria, valor: installmentNet(p), status: p.status });
    }
  }
  return out;
}

export function render(el, rerender) {
  const ym = ui.month;
  const items = carItems(ym);
  const mensal = sum(items, i => i.valor);

  const year = ym.slice(0, 4);
  const mesesDoAno = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  let anual = 0;
  const meses = [];
  for (const mm of mesesDoAno) {
    const v = sum(carItems(mm), i => i.valor);
    anual += v;
    meses.push([ymShort(mm), v]);
  }

  const provCarro = db.provisions.filter(p => isCarro(p.categoria) || /carro|ipva|seguro|pneu|revis/i.test(p.nome));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Custo do carro no mês', mensal),
    statCard(`Custo no ano de ${year}`, anual),
    statCard('Provisões do carro (mensal)', sum(provCarro, p => provisionMonthly(p, ym))),
    statCard('Provisionado para o carro', sum(provCarro, p => p.valorAcumulado), { tone: 'tone-ok' })));

  // ---- Indicadores de combustível: mês e ano ----
  const fuelMes = carFuelStats([ym]);
  const fuelAno = carFuelStats(mesesDoAno);
  el.append(card('Combustível',
    h('div', { class: 'grid grid-cards' },
      statCard('Valor gasto no mês', fuelMes.valorGasto),
      statCard('Consumo médio no mês', fuelMes.consumoMedio != null ? `${fuelMes.consumoMedio.toFixed(1)} km/L` : '—',
        { sub: fuelMes.km ? `${fuelMes.km} km rodados` : 'precisa de 2 abastecimentos seguidos' }),
      statCard('Custo médio por km no mês', fuelMes.custoPorKm != null ? `${fmt(fuelMes.custoPorKm)}/km` : '—'),
      statCard(`Valor gasto no ano de ${year}`, fuelAno.valorGasto),
      statCard(`Consumo médio no ano`, fuelAno.consumoMedio != null ? `${fuelAno.consumoMedio.toFixed(1)} km/L` : '—'),
      statCard(`Custo médio por km no ano`, fuelAno.custoPorKm != null ? `${fmt(fuelAno.custoPorKm)}/km` : '—')),
    h('div', { class: 'card-head', style: 'margin-top:14px' },
      h('h2', { class: 'card-title' }, 'Abastecimentos'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => refuelingModal(rerender) }, '+ Novo abastecimento')),
    renderRefuelingsTable(ym, rerender)));

  // Por subcategoria
  const porSub = {};
  for (const i of items) porSub[i.sub || 'Outros'] = (porSub[i.sub || 'Outros'] || 0) + i.valor;
  el.append(h('div', { class: 'grid grid-2' },
    card('Custo por categoria no mês', donut(Object.entries(porSub).sort((a, b) => b[1] - a[1]), { size: 170 })),
    card('Evolução mensal no ano',
      bars(meses.map(m => m[0]), [{ name: 'Custo do carro', color: CHART_COLORS[3], values: meses.map(m => m[1]) }], { height: 200 }))));

  el.append(card('Lançamentos do carro no mês',
    table([
      { label: 'Data', k: 'data', date: true },
      { label: 'Descrição', k: 'descricao' },
      { label: 'Categoria', k: 'sub' },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Status', render: i => badge(i.status) },
    ], items.sort((a, b) => a.data.localeCompare(b.data)),
    { empty: 'Nenhuma despesa do carro neste mês. Use as categorias Carro, Combustível ou Transporte, ou as subcategorias: ' + SUBCATS.join(', ') + '.' })));

  if (provCarro.length) {
    el.append(card('Provisões ligadas ao carro',
      table([
        { label: 'Provisão', k: 'nome' },
        { label: 'Alvo', k: 'valorAlvo', money: true },
        { label: 'Mensal', render: p => fmt(provisionMonthly(p, ym)), right: true },
        { label: 'Acumulado', k: 'valorAcumulado', money: true },
        { label: 'Status', render: p => badge(p.status) },
      ], provCarro)));
  }
}

// ---- Abastecimentos ----
function refuelingFields() {
  return [
    { k: 'data', label: 'Data', type: 'date', required: true, value: todayISO() },
    { k: 'kmRegistrado', label: 'Km registrado no dia', type: 'number', required: true, min: 0 },
    { k: 'precoLitro', label: 'Preço por litro (R$)', type: 'money', required: true, step: '0.01',
      onchange: v => { if (v.precoLitro && v.litros && !v._vtManual) v.valorTotal = +(v.precoLitro * v.litros).toFixed(2); } },
    { k: 'litros', label: 'Litragem total (L)', type: 'number', required: true, min: 0, step: '0.01',
      onchange: v => { if (v.precoLitro && v.litros && !v._vtManual) v.valorTotal = +(v.precoLitro * v.litros).toFixed(2); } },
    { k: 'valorTotal', label: 'Valor total do tanque completo (R$)', type: 'money', required: true,
      help: 'Calculado automaticamente a partir do preço e da litragem — ajuste se o valor cobrado for diferente.',
      onchange: v => { v._vtManual = true; } },
    { k: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS_PAGAMENTO, required: true },
    { k: 'cartaoId', label: 'Cartão', type: 'select', options: db.cards.map(c => [c.id, c.nome]),
      show: v => v.formaPagamento === 'Cartão de crédito', required: true,
      help: db.cards.length ? 'Some automaticamente na fatura deste cartão — não precisa lançar de novo lá.' : 'Cadastre um cartão em Cartões e parcelas.' },
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome) },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

// Mantém a despesa vinculada ao abastecimento em sincronia — some na fatura do cartão (via
// cardInvoice) e entra no orçamento normalmente, sem precisar cadastrar duas vezes.
function syncRefuelingExpense(refueling) {
  const patch = {
    dataCompra: refueling.data, dataVencimento: refueling.data,
    descricao: `Abastecimento — ${Number(refueling.litros).toFixed(2)}L`,
    categoria: 'Combustível', valorTotal: Number(refueling.valorTotal) || 0,
    formaPagamento: refueling.formaPagamento, banco: refueling.banco,
    cartaoId: refueling.formaPagamento === 'Cartão de crédito' ? refueling.cartaoId : '',
    natureza: 'variavel', status: 'pago', dataPagamento: refueling.data,
    responsavel: '', reembolsavel: false,
  };
  if (refueling.expenseId && db.expenses.some(e => e.id === refueling.expenseId)) {
    update('expenses', refueling.expenseId, patch);
  } else {
    const exp = add('expenses', patch);
    update('refuelings', refueling.id, { expenseId: exp.id });
  }
}

function saveRefueling(vals, existingId) {
  const refueling = existingId ? update('refuelings', existingId, vals) : add('refuelings', vals);
  syncRefuelingExpense(refueling);
  save();
}

function refuelingModal(rerender, existing) {
  formModal(existing ? 'Editar abastecimento' : 'Novo abastecimento', refuelingFields(), existing || {}, vals => {
    saveRefueling(vals, existing?.id);
    toast(existing ? 'Abastecimento atualizado.' : 'Abastecimento registrado.');
    rerender();
  }, { wide: true });
}

function renderRefuelingsTable(ym, rerender) {
  const doMes = db.refuelings.filter(r => ymOf(r.data) === ym).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return table([
    { label: 'Data', render: r => fmtDate(r.data) },
    { label: 'Km', render: r => Number(r.kmRegistrado).toLocaleString('pt-BR') },
    { label: 'Litros', render: r => `${Number(r.litros).toFixed(2)} L` },
    { label: 'Preço/L', k: 'precoLitro', money: true },
    { label: 'Valor total', k: 'valorTotal', money: true },
    { label: 'Pagamento', render: r => r.formaPagamento === 'Cartão de crédito'
        ? `${r.formaPagamento} (${db.cards.find(c => c.id === r.cartaoId)?.nome || '—'})` : r.formaPagamento },
    { label: '', render: r => rowActions(
        ['✏️', () => refuelingModal(rerender, r), 'Editar'],
        ['🗑', () => confirmModal(`Excluir o abastecimento de ${fmtDate(r.data)}? A despesa vinculada também será excluída.`, () => {
          if (r.expenseId) remove('expenses', r.expenseId);
          remove('refuelings', r.id);
          rerender();
        }), 'Excluir']), right: true },
  ], doMes, { empty: 'Nenhum abastecimento registrado neste mês.' });
}
