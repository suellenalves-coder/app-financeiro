// Mapa de parcelamentos futuros: tela própria, um mês por vez (com o seletor de mês do
// topo), em vez da antiga tabela única com todos os cartões e meses até anos à frente
// misturados. Um gráfico dá o contexto dos próximos meses; a tabela mostra só o mês atual.
import { h, fmt, ymAdd, ymShort, ymLabel, sum } from '../utils.js';
import { db, ui } from '../store.js';
import { monthInstallments, futureInstallmentsTotal } from '../calc.js';
import { card, searchableTable, badge, statCard } from '../ui.js';
import { bars, CHART_COLORS } from '../charts.js';

const HORIZONTE = 18;
const filtro = { search: '', status: '' };
const STATUS_PARCELA = [['previsto', 'Previsto'], ['pago', 'Pago']];

export function render(el) {
  const ym = ui.month;

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Comprometido a partir deste mês', futureInstallmentsTotal(ymAdd(ym, -1)),
      { sub: `próximos ${HORIZONTE} meses` }),
    statCard(`Parcelas previstas em ${ymLabel(ym)}`, sum(monthInstallments(ym), p => p.valor))));

  const meses = Array.from({ length: HORIZONTE }, (_, i) => ymAdd(ym, i));
  const totaisPorMes = meses.map(m => sum(monthInstallments(m), p => p.valor));

  el.append(card(`Comprometido por mês (próximos ${HORIZONTE} meses)`,
    bars(meses.map(ymShort), [{ name: 'Parcelas', color: CHART_COLORS[3], values: totaisPorMes }], { height: 200 }),
    h('p', { class: 'stat-sub' }, 'Use o seletor de mês no topo da tela para ver o detalhe de cada mês abaixo.')));

  const rows = monthInstallments(ym).map(p => {
    const compra = db.purchases.find(x => x.id === p.purchaseId);
    return {
      cartao: db.cards.find(c => c.id === p.cartaoId)?.nome || '—',
      descricao: compra?.descricao || '—', parcela: `${p.numero}/${p.total}`,
      valor: p.valor, categoria: compra?.categoria || '—', status: p.status,
    };
  });
  const cols = [
    { label: 'Cartão', k: 'cartao' },
    { label: 'Descrição', k: 'descricao' },
    { label: 'Categoria', k: 'categoria' },
    { label: 'Parcela', k: 'parcela' },
    { label: 'Valor', k: 'valor', money: true },
    { label: 'Status', render: r => badge(r.status) },
  ];

  el.append(card(`Parcelas previstas em ${ymLabel(ym)} (${rows.length})`,
    searchableTable(rows, cols, filtro, {
      searchKeys: ['descricao', 'categoria', 'cartao'], statusOptions: STATUS_PARCELA,
      empty: 'Nenhuma parcela prevista neste mês.',
    })));
}
