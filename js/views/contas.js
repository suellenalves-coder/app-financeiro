// Contas bancárias: cadastro simples e saldo sempre calculado ao vivo (saldo inicial +
// receitas recebidas + despesas pagas vinculadas + conciliações manuais).
import { h, fmt, todayISO } from '../utils.js';
import { db, add, update, remove } from '../store.js';
import { accountBalance } from '../calc.js';
import { card, table, formModal, confirmModal, rowActions, statCard, toast } from '../ui.js';

// Nome de exibição de uma conta: "Apelido — Banco" (ou só o banco, se não tiver apelido).
export function contaLabel(a) {
  return a.apelido ? `${a.apelido} — ${a.banco}` : a.banco;
}

function fields(vals = {}) {
  return [
    { k: 'banco', label: 'Banco', type: 'select', options: db.banks.map(b => b.nome), required: true,
      help: db.banks.length ? '' : 'Cadastre bancos em Configurações.' },
    { k: 'apelido', label: 'Apelido da conta', type: 'text', placeholder: 'Ex.: Conta corrente, Conta salário…' },
    { k: 'saldoInicial', label: 'Saldo inicial (R$)', type: 'money', required: true, value: 0,
      help: 'A partir daqui o saldo atual é calculado sozinho, conforme você marca receitas/despesas como recebidas/pagas nesta conta.' },
  ];
}

function conciliarModal(conta, rerender) {
  const atual = accountBalance(conta.id);
  const overlay = formModal(`Conciliar saldo — ${contaLabel(conta)}`, [
    { k: 'saldoReal', label: 'Saldo real (conforme o extrato do banco)', type: 'money', required: true, value: atual,
      help: `Saldo calculado pelo app hoje: ${fmt(atual)}.` },
    { k: 'obs', label: 'Observações', type: 'text' },
  ], {}, vals => {
    const diff = +(Number(vals.saldoReal) - atual).toFixed(2);
    if (Math.abs(diff) < 0.005) { toast('Já está batendo com o calculado — nenhum ajuste necessário.'); return; }
    add('accountAdjustments', { contaId: conta.id, data: todayISO(), valor: diff, obs: vals.obs || 'Conciliação manual' });
    toast(`Ajuste de ${fmt(diff)} registrado para bater com o extrato.`);
    rerender();
  }, { saveLabel: 'Conciliar' });
  return overlay;
}

export function render(el, rerender) {
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, 'Contas bancárias'),
      h('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => formModal('Nova conta', fields(), {}, vals => { add('accounts', { ...vals, ativo: true }); toast('Conta cadastrada.'); rerender(); }),
      }, '+ Nova conta')),
    h('p', { class: 'stat-sub' },
      'O saldo atual é sempre calculado a partir do saldo inicial, das receitas marcadas como recebidas e das despesas marcadas como pagas vinculadas a cada conta. Use "Conciliar saldo" quando o valor calculado não bater com o extrato real do banco.'),
    !db.accounts.length ? h('div', { class: 'empty-state' }, 'Nenhuma conta cadastrada ainda.') : h('div', { class: 'grid grid-cards' },
      db.accounts.map(a => statCard(contaLabel(a), accountBalance(a.id), {
        tone: accountBalance(a.id) < 0 ? 'tone-bad' : 'tone-ok',
        sub: `saldo inicial: ${fmt(a.saldoInicial)}`,
      })))));

  if (db.accounts.length) {
    el.append(card('Gerenciar contas',
      table([
        { label: 'Banco', k: 'banco' },
        { label: 'Apelido', render: a => a.apelido || '—' },
        { label: 'Saldo inicial', k: 'saldoInicial', money: true },
        { label: 'Saldo atual', render: a => fmt(accountBalance(a.id)), right: true },
        { label: '', render: a => rowActions(
            ['🎯', () => conciliarModal(a, rerender), 'Conciliar saldo'],
            ['✏️', () => formModal('Editar conta', fields(a), a, vals => { update('accounts', a.id, vals); rerender(); }), 'Editar'],
            ['🗑', () => confirmModal(`Excluir a conta "${contaLabel(a)}"? Receitas e despesas já vinculadas mantêm o valor, mas perdem o vínculo com a conta.`, () => {
              remove('accounts', a.id);
              rerender();
            }), 'Excluir']), right: true },
      ], db.accounts)));
  }
}
