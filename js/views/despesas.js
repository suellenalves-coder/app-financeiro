// Despesas avulsas: cadastro completo, pagamento rápido, duplicação, filtros e importação em massa.
import { h, fmt, todayISO, parseDate, parseTable, parseMoney, sum, uid } from '../utils.js';
import {
  db, ui, add, update, remove, removeWhere, save, applyRules,
  CLASSIFICACAO_DESPESA, STATUS_DESPESA, FORMAS_PAGAMENTO,
} from '../store.js';
import { monthExpenses, expenseNet } from '../calc.js';
import { card, table, badge, formModal, confirmModal, modal, rowActions, statCard, toast } from '../ui.js';
import { contaLabel } from './contas.js';

// Recalcula o valor a reembolsar (R$) a partir do percentual × valor total — usado nos
// onchange de valorTotal, reembolsavel e percentualReembolso, pra manter os três em sincronia.
function aplicarPercentualReembolso(v) {
  v.valorReembolsavel = +((Number(v.valorTotal) || 0) * (Number(v.percentualReembolso) || 0) / 100).toFixed(2);
}

// vals: despesa sendo editada (ou {} para uma nova), só pra pré-preencher o percentual de
// registros antigos que só tinham o valor fixo em R$ salvo (compatibilidade).
export function fields(vals = {}) {
  const cats = db.categoriesExpense.map(c => c.nome);
  const percentualPadrao = vals.percentualReembolso ??
    (Number(vals.valorTotal) > 0 && Number(vals.valorReembolsavel) > 0
      ? +(Number(vals.valorReembolsavel) / Number(vals.valorTotal) * 100).toFixed(1) : 100);
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
    { k: 'valorTotal', label: 'Valor total (R$)', type: 'money', required: true,
      onchange: v => { if (v.reembolsavel) aplicarPercentualReembolso(v); } },
    { k: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS_PAGAMENTO },
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome) },
    { k: 'cartaoId', label: 'Cartão', type: 'select', options: db.cards.map(c => [c.id, c.nome]),
      show: v => v.formaPagamento === 'Cartão de crédito' },
    { k: 'contaId', label: 'Conta bancária', type: 'select', options: db.accounts.map(a => [a.id, contaLabel(a)]),
      show: v => v.formaPagamento !== 'Cartão de crédito',
      help: db.accounts.length ? 'Ao marcar como paga, o valor é descontado automaticamente do saldo desta conta.' : 'Cadastre contas em Contas bancárias.' },
    { k: 'natureza', label: 'Natureza', type: 'select', options: [['fixa', 'Fixa'], ['variavel', 'Variável']], value: 'variavel', required: true },
    { k: 'tipo', label: 'Classificação estratégica', type: 'select', options: CLASSIFICACAO_DESPESA },
    { k: 'status', label: 'Status de pagamento', type: 'select', options: STATUS_DESPESA, value: 'previsto', required: true },
    { k: 'responsavel', label: 'Responsável', type: 'text', placeholder: 'Quem fez o gasto' },
    { k: 'reembolsavel', label: 'Despesa reembolsável / compartilhada', type: 'check',
      onchange: v => {
        if (v.reembolsavel && !v.percentualReembolso) v.percentualReembolso = percentualPadrao;
        if (v.reembolsavel) aplicarPercentualReembolso(v);
      } },
    { k: 'pessoaId', label: 'Pessoa que vai reembolsar', type: 'select',
      options: db.people.map(p => [p.id, p.nome]), show: v => v.reembolsavel,
      help: db.people.length ? '' : 'Cadastre pessoas em Configurações.' },
    { k: 'percentualReembolso', label: 'Percentual a reembolsar (%)', type: 'number', min: 0, max: 100, step: 1,
      show: v => v.reembolsavel, value: percentualPadrao,
      chips: [['100% (integral)', 100], ['50% (dividir igual)', 50]],
      help: 'Só a parte líquida (total − reembolso) pesa no seu orçamento.',
      onchange: v => aplicarPercentualReembolso(v) },
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
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn btn-secondary btn-sm', onclick: () => importModal(rerender) }, '⬆ Importar em massa'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => quickAdd(rerender) }, '+ Nova despesa'))),
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
    ['✏️', () => formModal('Editar despesa', fields(e), e, vals => { saveExpense(vals, e.id); rerender(); }, { wide: true }), 'Editar'],
    ['⧉', () => {
      const copy = { ...e, status: 'previsto', dataPagamento: '' };
      delete copy.id;
      formModal('Duplicar despesa', fields(copy), copy, vals => { saveExpense(vals); toast('Despesa duplicada.'); rerender(); }, { wide: true });
    }, 'Duplicar'],
    ['🗑', () => confirmModal(`Excluir a despesa "${e.descricao}"?`, () => {
      removeWhere('reimbursements', r => r.expenseId === e.id);
      remove('expenses', e.id);
      rerender();
    }), 'Excluir']);
  return rowActions(...btns);
}

// ---- Importação em massa ----
const IMPORT_HEADERS = 'descricao;categoria;valor;data_vencimento;data_compra;forma_pagamento;banco;cartao;natureza;status;responsavel;reembolsavel;pessoa_reembolso;percentual_reembolso;observacoes';
const IMPORT_EXAMPLE = 'Aluguel;Moradia;1500,00;05/07/2026;01/07/2026;Débito automático;Santander;;fixa;previsto;Suellen;não;;;pagamento mensal\nJantar dividido;Alimentação fora de casa;120,00;03/07/2026;;Pix;;;variavel;previsto;Suellen;sim;Irmão;50;';

function importModal(rerender) {
  const ta = h('textarea', {
    rows: 8, style: 'width:100%;font-family:monospace;font-size:12px',
    placeholder: `${IMPORT_HEADERS}\n${IMPORT_EXAMPLE}`,
  });
  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,.tsv' });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) f.text().then(t => { ta.value = t; });
  });
  const result = h('div', { class: 'stat-sub', style: 'margin-top:8px' });

  const overlay = modal('Importar despesas em massa', h('div', {},
    h('p', { class: 'stat-sub' },
      'Cole a tabela (do Excel, Google Sheets ou CSV) ou envie um arquivo. A primeira linha deve conter os cabeçalhos. Separadores aceitos: ponto e vírgula, vírgula ou tabulação.'),
    h('p', { class: 'stat-sub' }, 'Colunas reconhecidas: ', h('code', {}, IMPORT_HEADERS.replaceAll(';', ' · '))),
    h('p', { class: 'stat-sub' }, 'Datas em dd/mm/aaaa. Categoria, forma de pagamento e status são casados com os valores já cadastrados; o que não bater entra como texto livre (categoria) ou "Previsto" (status).'),
    h('p', { class: 'stat-sub' }, 'reembolsavel aceita sim/não. Com "sim", pessoa_reembolso é criada automaticamente se ainda não existir, e percentual_reembolso divide o valor total pela mesma lógica de Reembolsos (deixe em branco para reembolso integral, 100%).'),
    fileInput, h('div', { style: 'height:8px' }), ta, result,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', onclick: () => overlay.remove() }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: () => {
        const res = importRows(ta.value);
        if (res.error) { result.textContent = res.error; result.style.color = 'var(--erro)'; return; }
        overlay.remove();
        toast(`${res.count} despesa(s) importada(s).`);
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
    const valorTotal = parseMoney(col(r, 'valor', 'valor_total', 'valor total'));
    if (!descricao || !valorTotal) { errors.push(idx + 2); return; }

    const dataCompra = parseDate(col(r, 'data_compra', 'data da compra', 'data')) || todayISO();
    const dataVencimento = parseDate(col(r, 'data_vencimento', 'data de vencimento', 'vencimento')) || dataCompra;

    const categoriaRaw = col(r, 'categoria');
    const categoria = db.categoriesExpense.find(c => c.nome.toLowerCase() === categoriaRaw.toLowerCase())?.nome || categoriaRaw || 'Outros';

    const formaRaw = col(r, 'forma_pagamento', 'forma de pagamento', 'pagamento');
    const formaPagamento = FORMAS_PAGAMENTO.find(f => f.toLowerCase() === formaRaw.toLowerCase()) || formaRaw;

    const cartaoNome = col(r, 'cartao', 'cartão');
    let cartaoId = '';
    if (formaPagamento === 'Cartão de crédito' && cartaoNome) {
      let cartao = db.cards.find(c => c.nome.toLowerCase() === cartaoNome.toLowerCase());
      if (!cartao) cartao = add('cards', { nome: cartaoNome, banco: '', limitePlanejado: 0, ativo: true });
      cartaoId = cartao.id;
    }

    const natureza = col(r, 'natureza').toLowerCase() === 'fixa' ? 'fixa' : 'variavel';

    const statusRaw = col(r, 'status').toLowerCase();
    const statusMatch = STATUS_DESPESA.find(([v, l]) => v === statusRaw || l.toLowerCase() === statusRaw);
    const status = statusMatch ? statusMatch[0] : 'previsto';

    // Reembolso: mesma lógica de divisão por percentual do módulo de Reembolsos
    // (valorAReembolsar = total × percentual/100); sem percentual, assume 100% (integral).
    const reembolsavelRaw = col(r, 'reembolsavel').trim().toLowerCase();
    const reembolsavel = ['sim', 's', 'true', '1', 'yes'].includes(reembolsavelRaw);
    let pessoaId = '', valorReembolsavel = '';
    if (reembolsavel) {
      const pessoaNome = col(r, 'pessoa_reembolso', 'pessoa reembolso', 'pessoa');
      if (pessoaNome) {
        let pessoa = db.people.find(p => p.nome.toLowerCase() === pessoaNome.toLowerCase());
        if (!pessoa) pessoa = add('people', { nome: pessoaNome, ativo: true });
        pessoaId = pessoa.id;
      }
      const percentualRaw = col(r, 'percentual_reembolso', 'percentual reembolso', 'percentual', '% reembolso');
      const percentual = percentualRaw !== '' ? (Number(String(percentualRaw).replace('%', '').replace(',', '.')) || 0) : 100;
      valorReembolsavel = +(valorTotal * percentual / 100).toFixed(2);
    }

    const exp = add('expenses', {
      descricao, dataCompra, dataVencimento, categoria, valorTotal,
      formaPagamento, banco: col(r, 'banco'), cartaoId, natureza, status,
      responsavel: col(r, 'responsavel', 'responsável'),
      reembolsavel, pessoaId, valorReembolsavel,
      obs: [col(r, 'observacoes', 'observações', 'obs'), '(importado em massa)'].filter(Boolean).join(' '),
    });
    syncReimbursement(exp);
    count++;
  });
  save();
  if (!count) return { error: `Nenhuma linha válida. Verifique descrição e valor (linhas: ${errors.join(', ')}).` };
  return { count };
}
