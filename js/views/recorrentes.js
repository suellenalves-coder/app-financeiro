// Contas recorrentes: regra + ocorrências mensais editáveis individualmente.
import { h, fmt, todayISO, ymNow, sum } from '../utils.js';
import { db, ui, add, update, remove, save, PERIODICIDADES, FORMAS_PAGAMENTO } from '../store.js';
import { recurringOccurrences } from '../calc.js';
import { card, table, badge, formModal, confirmModal, rowActions, statCard, toast } from '../ui.js';

function fields() {
  return [
    { k: 'nome', label: 'Nome da conta', type: 'text', required: true, placeholder: 'Ex.: Aluguel, Luz, Internet…' },
    { k: 'categoria', label: 'Categoria', type: 'select', options: db.categoriesExpense.map(c => c.nome), required: true },
    { k: 'valorPrevisto', label: 'Valor previsto (R$)', type: 'money', required: true },
    { k: 'diaVencimento', label: 'Dia de vencimento', type: 'number', min: 1, max: 31, required: true },
    { k: 'periodicidade', label: 'Periodicidade', type: 'select', options: PERIODICIDADES.map(p => [p[0], p[1]]), value: 'mensal', required: true },
    { k: 'dataInicio', label: 'Mês de início', type: 'month', value: ymNow(), required: true },
    { k: 'dataFim', label: 'Mês de fim (opcional)', type: 'month', help: 'Deixe vazio para contas sem prazo (útil para financiamentos com fim definido).' },
    { k: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS_PAGAMENTO },
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome) },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

export function render(el, rerender) {
  const ym = ui.month;
  const occs = recurringOccurrences(ym);

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Total do mês', sum(occs, o => o.valor)),
    statCard('Pagas', sum(occs.filter(o => o.status === 'pago'), o => o.valor), { tone: 'tone-ok' }),
    statCard('Em aberto', sum(occs.filter(o => o.status !== 'pago'), o => o.valor)),
    statCard('Vencidas', sum(occs.filter(o => o.status === 'vencido'), o => o.valor),
      { tone: occs.some(o => o.status === 'vencido') ? 'tone-bad' : '' })));

  // Ocorrências do mês
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, 'Ocorrências do mês'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Nova conta recorrente', fields(), {}, vals => { add('recurring', { ...vals, status: 'ativa' }); rerender(); }) }, '+ Nova conta recorrente')),
    table([
      { label: 'Vencimento', k: 'dataVencimento', date: true },
      { label: 'Conta', k: 'nome' },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Valor', k: 'valor', money: true },
      { label: 'Status', render: o => badge(o.status) },
      { label: '', render: o => occActions(o, rerender), right: true },
    ], occs, { empty: 'Nenhuma conta recorrente neste mês.' })));

  // Regras cadastradas
  el.append(card('Contas recorrentes cadastradas',
    table([
      { label: 'Conta', k: 'nome' },
      { label: 'Categoria', k: 'categoria' },
      { label: 'Valor previsto', k: 'valorPrevisto', money: true },
      { label: 'Vence dia', k: 'diaVencimento' },
      { label: 'Periodicidade', render: r => PERIODICIDADES.find(p => p[0] === r.periodicidade)?.[1] || r.periodicidade },
      { label: 'Vigência', render: r => `${r.dataInicio || '—'} → ${r.dataFim || 'sem fim'}` },
      { label: 'Status', render: r => badge(r.status) },
      { label: '', render: r => rowActions(
          [r.status === 'ativa' ? '⏸' : '▶️', () => { update('recurring', r.id, { status: r.status === 'ativa' ? 'pausada' : 'ativa' }); rerender(); }, r.status === 'ativa' ? 'Pausar' : 'Reativar'],
          ['✏️', () => formModal('Editar conta recorrente', fields(), r, vals => { update('recurring', r.id, vals); rerender(); }), 'Editar'],
          ['🗑', () => confirmModal(`Excluir a conta recorrente "${r.nome}"?`, () => { remove('recurring', r.id); rerender(); }), 'Excluir']), right: true },
    ], db.recurring, { empty: 'Nenhuma conta recorrente cadastrada. Comece pelo aluguel, condomínio, luz e assinaturas.' })));
}

function occActions(o, rerender) {
  const key = o.key;
  const setOcc = patch => {
    db.recurringOcc[key] = { ...(db.recurringOcc[key] || {}), ...patch };
    save();
    rerender();
  };
  const btns = [];
  if (o.status !== 'pago') {
    btns.push(['✔️', () => setOcc({ status: 'pago', dataPagamento: todayISO() }), 'Marcar como paga']);
  } else {
    btns.push(['↩︎', () => setOcc({ status: 'previsto', dataPagamento: '' }), 'Desfazer pagamento']);
  }
  btns.push(['✏️', () => {
    // Edita apenas a ocorrência do mês, sem alterar a regra original.
    formModal(`Editar apenas ${o.nome} deste mês`, [
      { k: 'valor', label: 'Valor deste mês (R$)', type: 'money', required: true, help: 'Altera só este mês; a regra recorrente continua igual.' },
      { k: 'status', label: 'Status', type: 'select', required: true,
        options: [['previsto', 'Previsto'], ['pago', 'Pago'], ['parcial', 'Parcialmente pago'], ['cancelado', 'Cancelado neste mês']] },
      { k: 'dataPagamento', label: 'Data de pagamento', type: 'date', show: v => v.status === 'pago' || v.status === 'parcial' },
    ], { valor: o.valor, status: o.status === 'vencido' ? 'previsto' : o.status, dataPagamento: o.dataPagamento }, vals => {
      setOcc(vals);
      toast('Ocorrência atualizada só neste mês.');
    });
  }, 'Editar este mês']);
  return rowActions(...btns);
}
