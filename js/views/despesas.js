// Despesas avulsas: cadastro completo, pagamento rápido, duplicação e filtros.
import { h, fmt, todayISO, sum, uid } from '../utils.js';
import {
  db, ui, add, update, remove, removeWhere, save, applyRules,
  CLASSIFICACAO_DESPESA, STATUS_DESPESA, FORMAS_PAGAMENTO,
} from '../store.js';
import { monthExpenses, expenseNet } from '../calc.js';
import { card, table, badge, formModal, confirmModal, rowActions, statCard, toast } from '../ui.js';

export function fields(vals = {}) {
  const cats = db.categoriesExpense.map(c => c.nome);
  return [
    { k: 'descricao', label: 'Descrição', type: 'text', required: true, full: true,
      onchange: v => {
        const sugestao = applyRules(v.descricao);
        if (sugestao.categoria && !v.categoria) v.categoria = sugestao.categoria;
      } },
    { k: 'dataCompra', label: 'Data da compra', type: 'date', required: true, value: todayISO() },
    { k: 'dataVencimento', label: 'Data de vencimento', type: 'date', help: 'Se vazio, usa a data da compra.' },
    { k: 'categoria', label: 'Categoria', type: 'select', options: cats },
    { k: 'subcategoria', label: 'Subcategoria', type: 'text' },
    { k: 'valorTotal', label: 'Valor total (R$)', type: 'money', required: true },
    { k: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS_PAGAMENTO },
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome) },
    { k: 'cartaoId', label: 'Cartão', type: 'select', options: db.cards.map(c => [c.id, c.nome]),
      show: v => v.formaPagamento === 'Cartão de crédito' },
    { k: 'natureza', label: 'Natureza', type: 'select', options: [['fixa', 'Fixa'], ['variavel', 'Variável']], value: 'variavel', required: true },
    { k: 'tipo', label: 'Classificação estratégica', type: 'select', options: CLASSIFICACAO_DESPESA },
    { k: 'status', label: 'Status de pagamento', type: 'select', options: STATUS_DESPESA, value: 'previsto', required: true },
    { k: 'responsavel', label: 'Responsável', type: 'text', placeholder: 'Quem fez o gasto' },
    { k: 'reembolsavel', label: 'Despesa reembolsável / compartilhada', type: 'check' },
    { k: 'pessoaId', label: 'Pessoa que vai reembolsar', type: 'select',
      options: db.people.map(p => [p.id, p.nome]), show: v => v.reembolsavel,
      help: db.people.length ? '' : 'Cadastre pessoas em Configurações.' },
    { k: 'valorReembolsavel', label: 'Valor a reembolsar (R$)', type: 'money', show: v => v.reembolsavel,
      help: 'Só a parte líquida (total − reembolso) pesa no seu orçamento.' },
    { k: 'provisao', label: 'Compõe uma provisão', type: 'check' },
    { k: 'comprovante', label: 'Comprovante (nome do arquivo ou link)', type: 'text', full: true },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

// Ao salvar despesa reembolsável, mantém o registro de reembolso vinculado em sincronia.
export function syncReimbursement(exp) {
  const existing = db.reimbursements.find(r => r.expenseId === exp.id);
  if (exp.reembolsavel && exp.pessoaId && Number(exp.valorReembolsavel) > 0) {
    if (existing) {
      Object.assign(existing, {
        pessoaId: exp.pessoaId, valorAReembolsar: Number(exp.valorReembolsavel),
        descricao: exp.descricao, data: exp.dataCompra, valorTotalDespesa: Number(exp.valorTotal),
        categoria: exp.categoria,
      });
    } else {
      db.reimbursements.push({
        id: uid(), expenseId: exp.id, pessoaId: exp.pessoaId,
        descricao: exp.descricao, data: exp.dataCompra, categoria: exp.categoria,
        valorTotalDespesa: Number(exp.valorTotal), criterio: 'fixo', percentual: '',
        valorAReembolsar: Number(exp.valorReembolsavel), valorRecebido: 0,
        status: 'pendente', dataSolicitacao: '', dataRecebimento: '', obs: '',
      });
    }
  } else if (existing && ['pendente', 'solicitado'].includes(existing.status)) {
    removeWhere('reimbursements', r => r === existing);
  }
  save();
}

export function saveExpense(vals, id) {
  if (!vals.dataVencimento) vals.dataVencimento = vals.dataCompra;
  const exp = id ? update('expenses', id, vals) : add('expenses', vals);
  syncReimbursement(exp);
  return exp;
}

export function quickAdd(rerender) {
  formModal('Nova despesa', fields(), {}, vals => { saveExpense(vals); toast('Despesa cadastrada.'); rerender(); }, { wide: true });
}

export function markPaid(exp, rerender) {
  formModal('Registrar pagamento', [
    { k: 'dataPagamento', label: 'Data do pagamento', type: 'date', required: true, value: todayISO() },
    { k: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS_PAGAMENTO, value: exp.formaPagamento },
  ], {}, vals => {
    update('expenses', exp.id, { status: 'pago', ...vals });
    toast('Despesa marcada como paga.');
    rerender();
  }, { saveLabel: 'Confirmar pagamento' });
}

const filtro = { categoria: '', status: '', cartao: '' };

export function render(el, rerender) {
  const ym = ui.month;
  let list = monthExpenses(ym);
  if (filtro.categoria) list = list.filter(e => e.categoria === filtro.categoria);
  if (filtro.status) list = list.filter(e => e.status === filtro.status);
  if (filtro.cartao) list = list.filter(e => e.cartaoId === filtro.cartao);
  list.sort((a, b) => (a.dataVencimento || a.dataCompra).localeCompare(b.dataVencimento || b.dataCompra));

  const bruta = sum(list, e => e.valorTotal);
  const liquida = sum(list, expenseNet);

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Despesa bruta do mês', bruta, { sub: 'tudo que você paga' }),
    statCard('Despesa líquida real', liquida, { sub: 'descontando reembolsos', tone: 'tone-accent' }),
    statCard('Pagas', sum(list.filter(e => e.status === 'pago'), e => e.valorTotal), { tone: 'tone-ok' }),
    statCard('Em aberto', sum(list.filter(e => ['previsto', 'vencido', 'parcial'].includes(e.status)), e => e.valorTotal))));

  const sel = (k, opts, label) => {
    const s = h('select', { onchange: e => { filtro[k] = e.target.value; rerender(); } },
      h('option', { value: '' }, label),
      opts.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: filtro[k] === v }, l);
      }));
    return s;
  };

  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, 'Despesas do mês'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => quickAdd(rerender) }, '+ Nova despesa')),
    h('div', { class: 'filters' },
      sel('categoria', db.categoriesExpense.map(c => c.nome), 'Todas as categorias'),
      sel('status', STATUS_DESPESA, 'Todos os status'),
      db.cards.length ? sel('cartao', db.cards.map(c => [c.id, c.nome]), 'Todos os cartões') : null),
    table([
      { label: 'Vencimento', render: e => e.dataVencimento || e.dataCompra, date: true },
      { label: 'Descrição', render: e => h('span', {},
          e.descricao,
          e.reembolsavel ? h('span', { title: 'Reembolsável', style: 'margin-left:5px' }, '🤝') : null,
          !e.categoria ? h('span', { class: 'badge badge-warn', style: 'margin-left:6px' }, 'sem categoria') : null) },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Valor', k: 'valorTotal', money: true },
      { label: 'Líquido', render: e => e.reembolsavel ? fmt(expenseNet(e)) : '—', right: true },
      { label: 'Pagamento', k: 'formaPagamento' },
      { label: 'Status', render: e => badge(e.status) },
      { label: '', render: e => actions(e, rerender), right: true },
    ], list, { empty: 'Nenhuma despesa neste mês.' })));
}

function actions(e, rerender) {
  const btns = [];
  if (e.status !== 'pago') btns.push(['✔️', () => markPaid(e, rerender), 'Marcar como paga']);
  btns.push(
    ['✏️', () => formModal('Editar despesa', fields(), e, vals => { saveExpense(vals, e.id); rerender(); }, { wide: true }), 'Editar'],
    ['⧉', () => {
      const copy = { ...e, id: undefined, status: 'previsto', dataPagamento: '' };
      formModal('Duplicar despesa', fields(), copy, vals => { saveExpense(vals); toast('Despesa duplicada.'); rerender(); }, { wide: true });
    }, 'Duplicar'],
    ['🗑', () => confirmModal(`Excluir a despesa "${e.descricao}"?`, () => {
      removeWhere('reimbursements', r => r.expenseId === e.id);
      remove('expenses', e.id);
      rerender();
    }), 'Excluir']);
  return rowActions(...btns);
}
