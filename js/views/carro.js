// Módulo do carro: custos consolidados de todas as despesas ligadas ao carro.
import { h, fmt, ymShort, ymAdd, ymOf, sum } from '../utils.js';
import { db, ui, CATEGORIAS_CARRO } from '../store.js';
import { monthExpenses, recurringOccurrences, monthInstallments, expenseNet, provisionMonthly } from '../calc.js';
import { card, statCard, table, badge } from '../ui.js';
import { bars, donut, CHART_COLORS } from '../charts.js';

const SUBCATS = ['Financiamento', 'Combustível', 'Seguro', 'Manutenção', 'Revisão', 'IPVA', 'Estacionamento', 'Lavagem', 'Multas', 'Outros'];

function isCarro(categoria) {
  return CATEGORIAS_CARRO.includes(categoria);
}

// Todas as despesas do carro em um mês (avulsas + recorrentes + parcelas).
function carItems(ym) {
  const out = [];
  for (const e of monthExpenses(ym).filter(e => isCarro(e.categoria))) {
    out.push({ data: e.dataVencimento || e.dataCompra, descricao: e.descricao, sub: e.subcategoria || e.categoria, valor: expenseNet(e), status: e.status });
  }
  for (const o of recurringOccurrences(ym).filter(o => isCarro(o.categoria))) {
    out.push({ data: o.dataVencimento, descricao: o.nome, sub: o.categoria, valor: o.valor, status: o.status });
  }
  for (const p of monthInstallments(ym)) {
    const compra = db.purchases.find(c => c.id === p.purchaseId);
    if (compra && isCarro(compra.categoria)) {
      out.push({ data: `${p.mes}-01`, descricao: `${compra.descricao} (${p.numero}/${p.total})`, sub: compra.subcategoria || compra.categoria, valor: p.valor, status: p.status });
    }
  }
  return out;
}

export function render(el) {
  const ym = ui.month;
  const items = carItems(ym);
  const mensal = sum(items, i => i.valor);

  const year = ym.slice(0, 4);
  let anual = 0;
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const mm = `${year}-${String(m).padStart(2, '0')}`;
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
