// Receitas: cadastro, recorrência e acompanhamento.
import { h, fmt, todayISO, sum } from '../utils.js';
import { db, ui, add, update, remove, save, TIPOS_RECEITA, STATUS_RECEITA } from '../store.js';
import { monthIncomes } from '../calc.js';
import { card, table, badge, formModal, confirmModal, rowActions, statCard, heroStat, toast } from '../ui.js';
import { contaLabel } from './contas.js';

const TIPO_LABEL = Object.fromEntries(TIPOS_RECEITA);

function fields(vals = {}) {
  return [
    { k: 'data', label: 'Data de recebimento', type: 'date', required: true, value: todayISO() },
    { k: 'descricao', label: 'Descrição', type: 'text', required: true, placeholder: 'Ex.: Salário, aula, projeto…' },
    { k: 'categoria', label: 'Categoria', type: 'select', options: db.categoriesIncome.map(c => c.nome), required: true },
    { k: 'valor', label: 'Valor (R$)', type: 'money', required: true },
    { k: 'tipo', label: 'Tipo de receita', type: 'select', options: TIPOS_RECEITA, required: true, value: 'segura',
      help: 'Reembolsos devem ser registrados na tela Reembolsos, vinculados à despesa original.' },
    { k: 'status', label: 'Status', type: 'select', options: STATUS_RECEITA, required: true, value: 'prevista' },
    { k: 'contaId', label: 'Conta bancária', type: 'select', options: db.accounts.map(a => [a.id, contaLabel(a)]),
      help: db.accounts.length ? 'Ao marcar como recebida, o valor é somado automaticamente ao saldo desta conta.' : 'Cadastre contas em Contas bancárias.' },
    { k: 'recorrente', label: 'Receita recorrente (repete todo mês)', type: 'check' },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

const filtro = { tipo: '' };

export function render(el, rerender) {
  const ym = ui.month;
  let incomes = monthIncomes(ym).sort((a, b) => a.data.localeCompare(b.data));
  if (filtro.tipo) incomes = incomes.filter(i => i.tipo === filtro.tipo);

  el.append(heroStat('Total do mês', sum(incomes, i => i.valor)));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Recebido', sum(incomes.filter(i => i.status === 'recebida'), i => i.valor), { tone: 'tone-ok' }),
    statCard('Previsto', sum(incomes.filter(i => i.status === 'prevista'), i => i.valor)),
    statCard('Segura', sum(incomes.filter(i => i.tipo === 'segura'), i => i.valor))));

  const addBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    onclick: () => formModal('Nova receita', fields(), {}, vals => { add('incomes', vals); rerender(); }),
  }, '+ Nova receita');

  const sel = (k, opts, label) => h('select', { onchange: e => { filtro[k] = e.target.value; rerender(); } },
    h('option', { value: '' }, label),
    opts.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: filtro[k] === v }, l);
    }));

  el.append(card(null,
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Receitas do mês'), addBtn),
    h('div', { class: 'filters' }, sel('tipo', TIPOS_RECEITA, 'Todos os tipos')),
    table([
      { label: 'Data', k: 'data', date: true },
      { label: 'Descrição', render: r => h('span', {}, r.descricao, r.recorrente || r.virtual ? h('span', { title: 'Recorrente', style: 'margin-left:6px' }, '🔁') : null) },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Tipo', render: r => TIPO_LABEL[r.tipo] || r.tipo },
      { label: 'Origem', render: r => r.origem || '—' },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Status', render: r => badge(r.status) },
      { label: '', render: r => actions(r, rerender), right: true },
    ], incomes, { empty: 'Nenhuma receita neste mês para este filtro.', responsive: true })));
}

function actions(r, rerender) {
  // Ocorrência projetada de receita recorrente: ao editar/receber, materializa o lançamento no mês.
  const materialize = () => {
    if (!r.virtual) return r;
    const real = { ...r };
    delete real.id;
    delete real.virtual;
    return add('incomes', real);
  };
  const btns = [];
  if (r.status !== 'recebida') {
    btns.push(['✔️', () => {
      const real = materialize();
      update('incomes', real.id, { status: 'recebida' });
      toast('Receita marcada como recebida.');
      rerender();
    }, 'Marcar como recebida']);
  }
  btns.push(['✏️', () => {
    const real = materialize();
    formModal('Editar receita', fields(), real, vals => { update('incomes', real.id, vals); rerender(); });
  }, 'Editar']);
  if (!r.virtual) {
    const resgate = db.investRedemptions.find(x => x.incomeId === r.id);
    const aviso = resgate ? ' O saldo do investimento de origem será restaurado.' : (r.recorrente ? ' As projeções futuras também deixarão de aparecer.' : '');
    btns.push(['🗑', () => confirmModal(`Excluir a receita "${r.descricao}"?${aviso}`, () => {
      if (resgate) {
        const inv = db.investments.find(x => x.id === resgate.investimentoId);
        if (inv) update('investments', inv.id, { valorAtual: (Number(inv.valorAtual) || 0) + resgate.valor });
        remove('investRedemptions', resgate.id);
      }
      remove('incomes', r.id);
      rerender();
    }), 'Excluir']);
  }
  return rowActions(...btns);
}
