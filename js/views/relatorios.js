// Relatórios com filtros e exportação CSV.
import { h, fmt, ymShort, ymOf, sum, toCSV, downloadFile } from '../utils.js';
import { db, ui, STATUS_DESPESA, CLASSIFICACAO_DESPESA } from '../store.js';
import { annualRows, expenseNet, recurringOccurrences, monthInstallments, reimbPending, provisionMonthly } from '../calc.js';
import { card, table, badge, statCard } from '../ui.js';
import { donut } from '../charts.js';

const f = { relatorio: 'orcamento', ano: String(new Date().getFullYear()), mes: '', categoria: '', banco: '', cartao: '', pessoa: '', status: '', tipo: '' };

const RELATORIOS = [
  ['orcamento', 'Orçamento mensal (DRE pessoal)'],
  ['despesas', 'Despesas detalhadas'],
  ['categoria', 'Despesas por categoria no ano'],
  ['parcelamentos', 'Parcelamentos futuros'],
  ['reembolsos', 'Reembolsos por pessoa'],
  ['investimentos', 'Investimentos por banco'],
  ['provisoes', 'Provisões futuras'],
  ['recorrentes', 'Despesas recorrentes'],
];

export function render(el, rerender) {
  const sel = (k, opts, label) => h('select', { onchange: e => { f[k] = e.target.value; rerender(); } },
    h('option', { value: '' }, label),
    opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: f[k] === String(v) }, l); }));

  el.append(card(null, h('div', { class: 'filters' },
    h('select', { onchange: e => { f.relatorio = e.target.value; rerender(); } },
      RELATORIOS.map(([v, l]) => h('option', { value: v, selected: f.relatorio === v }, l))),
    sel('ano', [String(ui.year - 1), String(ui.year), String(ui.year + 1)], 'Ano: ' + f.ano),
    ...(f.relatorio === 'despesas' ? [
      sel('categoria', db.categoriesExpense.map(c => c.nome), 'Todas as categorias'),
      sel('status', STATUS_DESPESA, 'Todos os status'),
      sel('tipo', CLASSIFICACAO_DESPESA, 'Todas as classificações'),
      sel('banco', db.banks.map(b => b.nome), 'Todos os bancos'),
    ] : []),
    ...(f.relatorio === 'reembolsos' ? [sel('pessoa', db.people.map(p => [p.id, p.nome]), 'Todas as pessoas')] : []))));

  const year = Number(f.ano) || ui.year;
  const builders = { orcamento, despesas, categoria, parcelamentos, reembolsos, investimentos, provisoes, recorrentes };
  builders[f.relatorio](el, year);
}

function exportBtn(rows, headers, nome) {
  return h('button', {
    class: 'btn btn-ghost btn-sm',
    onclick: () => downloadFile(`${nome}.csv`, toCSV(rows, headers)),
  }, '⬇ Exportar CSV');
}

function head(title, rows, headers, nome) {
  return h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, title), exportBtn(rows, headers, nome));
}

function orcamento(el, year) {
  const rows = annualRows(year).map(r => ({
    mes: ymShort(r.ym),
    receita_total: r.receitaTotal.toFixed(2),
    receita_segura: r.receitaSegura.toFixed(2),
    despesas_fixas: r.despesasFixas.toFixed(2),
    despesas_variaveis: r.despVariaveis.toFixed(2),
    parcelamentos: r.parcelamentos.toFixed(2),
    provisoes: r.provisoes.toFixed(2),
    investimentos: r.investimentos.toFixed(2),
    saldo_previsto: r.saldoPrevisto.toFixed(2),
    saldo_livre_real: r.saldoLivreReal.toFixed(2),
    comprometimento_pct: r.comprometimento.toFixed(1),
  }));
  const headers = Object.keys(rows[0]);
  el.append(card(null, head(`DRE pessoal · ${year}`, rows, headers, `dre-${year}`),
    table(headers.map(hd => ({ label: hd.replaceAll('_', ' '), k: hd, right: hd !== 'mes' })), rows)));
}

function despesas(el, year) {
  let list = db.expenses.filter(e => (e.dataVencimento || e.dataCompra || '').startsWith(String(year)));
  if (f.categoria) list = list.filter(e => e.categoria === f.categoria);
  if (f.status) list = list.filter(e => e.status === f.status);
  if (f.tipo) list = list.filter(e => e.tipo === f.tipo);
  if (f.banco) list = list.filter(e => e.banco === f.banco);
  const rows = list.map(e => ({
    data: e.dataVencimento || e.dataCompra, descricao: e.descricao, categoria: e.categoria || '',
    classificacao: e.tipo || '', valor: Number(e.valorTotal).toFixed(2),
    valor_liquido: expenseNet(e).toFixed(2), forma: e.formaPagamento || '', banco: e.banco || '', status: e.status,
  }));
  el.append(card(null, head(`Despesas · ${year} (${rows.length})`, rows, ['data', 'descricao', 'categoria', 'classificacao', 'valor', 'valor_liquido', 'forma', 'banco', 'status'], `despesas-${year}`),
    table([
      { label: 'Data', k: 'data', date: true },
      { label: 'Descrição', k: 'descricao' },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Classificação', k: 'classificacao' },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Líquido', k: 'valor_liquido', money: true },
      { label: 'Status', render: r => badge(r.status) },
    ], rows),
    h('div', { class: 'stat-sub', style: 'margin-top:8px;text-align:right' },
      `Total: ${fmt(sum(rows, r => r.valor))} · Líquido: ${fmt(sum(rows, r => r.valor_liquido))}`)));
}

function categoria(el, year) {
  const map = {};
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    for (const e of db.expenses.filter(e => ymOf(e.dataVencimento || e.dataCompra) === ym && e.status !== 'cancelado')) {
      map[e.categoria || 'Sem categoria'] = (map[e.categoria || 'Sem categoria'] || 0) + expenseNet(e);
    }
    for (const o of recurringOccurrences(ym)) map[o.categoria || 'Sem categoria'] = (map[o.categoria || 'Sem categoria'] || 0) + o.valor;
    for (const p of monthInstallments(ym)) {
      const compra = db.purchases.find(c => c.id === p.purchaseId);
      map[compra?.categoria || 'Sem categoria'] = (map[compra?.categoria || 'Sem categoria'] || 0) + p.valor;
    }
  }
  const data = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const rows = data.map(([cat, v]) => ({ categoria: cat, valor: v.toFixed(2) }));
  el.append(card(null, head(`Despesas por categoria · ${year}`, rows, ['categoria', 'valor'], `categorias-${year}`),
    h('div', { class: 'grid grid-2' },
      donut(data, { size: 200, maxSlices: 5 }),
      table([{ label: 'Categoria', k: 'categoria' }, { label: 'Valor no ano', k: 'valor', money: true }], rows))));
}

function parcelamentos(el) {
  const rows = db.installments
    .filter(p => p.status !== 'pago')
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map(p => {
      const compra = db.purchases.find(c => c.id === p.purchaseId);
      return {
        mes: p.mes, cartao: db.cards.find(c => c.id === p.cartaoId)?.nome || '', descricao: compra?.descricao || '',
        parcela: `${p.numero}/${p.total}`, valor: Number(p.valor).toFixed(2), categoria: compra?.categoria || '',
      };
    });
  el.append(card(null, head(`Parcelamentos futuros (${fmt(sum(rows, r => r.valor))})`, rows, ['mes', 'cartao', 'descricao', 'parcela', 'valor', 'categoria'], 'parcelamentos'),
    table([
      { label: 'Mês', k: 'mes' }, { label: 'Cartão', k: 'cartao' }, { label: 'Descrição', k: 'descricao' },
      { label: 'Parcela', k: 'parcela' }, { label: 'Valor', k: 'valor', money: true }, { label: 'Categoria', k: 'categoria' },
    ], rows)));
}

function reembolsos(el) {
  let list = db.reimbursements;
  if (f.pessoa) list = list.filter(r => r.pessoaId === f.pessoa);
  const rows = list.map(r => ({
    data: r.data, pessoa: db.people.find(p => p.id === r.pessoaId)?.nome || '', descricao: r.descricao,
    valor_total: Number(r.valorTotalDespesa || 0).toFixed(2), a_reembolsar: Number(r.valorAReembolsar).toFixed(2),
    recebido: Number(r.valorRecebido || 0).toFixed(2), pendente: reimbPending(r).toFixed(2), status: r.status,
  }));
  el.append(card(null, head('Reembolsos por pessoa', rows, ['data', 'pessoa', 'descricao', 'valor_total', 'a_reembolsar', 'recebido', 'pendente', 'status'], 'reembolsos'),
    table([
      { label: 'Data', k: 'data', date: true }, { label: 'Pessoa', k: 'pessoa' }, { label: 'Descrição', k: 'descricao' },
      { label: 'A reembolsar', k: 'a_reembolsar', money: true }, { label: 'Recebido', k: 'recebido', money: true },
      { label: 'Pendente', k: 'pendente', money: true }, { label: 'Status', render: r => badge(r.status) },
    ], rows)));
}

function investimentos(el) {
  const rows = db.investments.map(i => ({
    banco: i.banco, produto: i.produto, tipo: i.tipo, objetivo: i.objetivo || '',
    valor_atual: Number(i.valorAtual).toFixed(2), aporte_mensal: Number(i.aporteMensalPlanejado || 0).toFixed(2),
  }));
  el.append(card(null, head(`Investimentos (${fmt(sum(rows, r => r.valor_atual))})`, rows, ['banco', 'produto', 'tipo', 'objetivo', 'valor_atual', 'aporte_mensal'], 'investimentos'),
    table([
      { label: 'Banco', k: 'banco' }, { label: 'Produto', k: 'produto' }, { label: 'Tipo', k: 'tipo' },
      { label: 'Valor atual', k: 'valor_atual', money: true }, { label: 'Aporte/mês', k: 'aporte_mensal', money: true },
    ], rows)));
}

function provisoes(el) {
  const rows = db.provisions.map(p => ({
    nome: p.nome, alvo: Number(p.valorAlvo).toFixed(2), data_alvo: p.dataAlvo || '',
    mensal: provisionMonthly(p, ui.month).toFixed(2), acumulado: Number(p.valorAcumulado || 0).toFixed(2), status: p.status,
  }));
  el.append(card(null, head('Provisões futuras', rows, ['nome', 'alvo', 'data_alvo', 'mensal', 'acumulado', 'status'], 'provisoes'),
    table([
      { label: 'Provisão', k: 'nome' }, { label: 'Alvo', k: 'alvo', money: true }, { label: 'Data alvo', k: 'data_alvo' },
      { label: 'Mensal', k: 'mensal', money: true }, { label: 'Acumulado', k: 'acumulado', money: true },
      { label: 'Status', render: r => badge(r.status) },
    ], rows)));
}

function recorrentes(el) {
  const rows = db.recurring.map(r => ({
    conta: r.nome, categoria: r.categoria || '', valor: Number(r.valorPrevisto).toFixed(2),
    dia: r.diaVencimento, periodicidade: r.periodicidade, inicio: r.dataInicio || '', fim: r.dataFim || '', status: r.status,
  }));
  el.append(card(null, head(`Despesas recorrentes (${fmt(sum(rows.filter(r => r.status === 'ativa' && r.periodicidade === 'mensal'), r => r.valor))}/mês)`, rows, ['conta', 'categoria', 'valor', 'dia', 'periodicidade', 'inicio', 'fim', 'status'], 'recorrentes'),
    table([
      { label: 'Conta', k: 'conta' }, { label: 'Categoria', k: 'categoria' }, { label: 'Valor', k: 'valor', money: true },
      { label: 'Dia', k: 'dia' }, { label: 'Periodicidade', k: 'periodicidade' }, { label: 'Status', render: r => badge(r.status) },
    ], rows)));
}
