// Receitas: cadastro, recorrência e acompanhamento.
import { h, fmt, todayISO, sum } from '../utils.js';
import { db, ui, add, update, remove, save, TIPOS_RECEITA, STATUS_RECEITA } from '../store.js';
import { monthIncomes } from '../calc.js';
import { card, table, badge, formModal, confirmModal, rowActions, statCard, toast } from '../ui.js';

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
    { k: 'recorrente', label: 'Receita recorrente (repete todo mês)', type: 'check' },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

export function render(el, rerender) {
  const ym = ui.month;
  const incomes = monthIncomes(ym).sort((a, b) => a.data.localeCompare(b.data));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Total do mês', sum(incomes, i => i.valor)),
    statCard('Recebido', sum(incomes.filter(i => i.status === 'recebida'), i => i.valor), { tone: 'tone-ok' }),
    statCard('Previsto', sum(incomes.filter(i => i.status === 'prevista'), i => i.valor)),
    statCard('Segura', sum(incomes.filter(i => i.tipo === 'segura'), i => i.valor))));

  const addBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    onclick: () => formModal('Nova receita', fields(), {}, vals => { add('incomes', vals); rerender(); }),
  }, '+ Nova receita');

  el.append(card(null,
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Receitas do mês'), addBtn),
    table([
      { label: 'Data', k: 'data', date: true },
      { label: 'Descrição', render: r => h('span', {}, r.descricao, r.recorrente || r.virtual ? h('span', { title: 'Recorrente', style: 'margin-left:6px' }, '🔁') : null) },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Tipo', render: r => TIPO_LABEL[r.tipo] || r.tipo },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Status', render: r => badge(r.status) },
      { label: '', render: r => actions(r, rerender), right: true },
    ], incomes, { empty: 'Nenhuma receita neste mês. Cadastre sua renda para começar.' })));
}

function actions(r, rerender) {
  // Ocorrência projetada de receita recorrente: ao editar/receber, materializa o lançamento no mês.
  const materialize = () => {
    if (!r.virtual) return r;
    const real = { ...r, id: undefined, virtual: undefined };
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
    btns.push(['🗑', () => confirmModal(`Excluir a receita "${r.descricao}"?${r.recorrente ? ' As projeções futuras também deixarão de aparecer.' : ''}`, () => { remove('incomes', r.id); rerender(); }), 'Excluir']);
  }
  return rowActions(...btns);
}
