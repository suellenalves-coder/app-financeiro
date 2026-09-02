// Provisões: reservas mensais para despesas futuras previsíveis.
import { h, fmt, ymNow, ymLabel, ymDiff, sum, todayISO } from '../utils.js';
import { db, ui, add, update, remove } from '../store.js';
import { provisionMonthly, monthProvisions, monthProvisionDeposits } from '../calc.js';
import { card, table, badge, formModal, confirmModal, rowActions, statCard, toast } from '../ui.js';

function fields() {
  return [
    { k: 'nome', label: 'Nome da provisão', type: 'text', required: true, placeholder: 'Ex.: IPVA, Seguro do carro, Viagem…' },
    { k: 'categoria', label: 'Categoria', type: 'select', options: db.categoriesExpense.map(c => c.nome) },
    { k: 'valorAlvo', label: 'Valor alvo (R$)', type: 'money', required: true },
    { k: 'dataAlvo', label: 'Data alvo', type: 'month', required: true },
    { k: 'valorMensal', label: 'Valor mensal (R$, opcional)', type: 'money',
      help: 'Se vazio, o app calcula automaticamente quanto guardar por mês até a data alvo.' },
    { k: 'valorAcumulado', label: 'Valor já provisionado (R$)', type: 'money', value: 0 },
    { k: 'obs', label: 'Observações', type: 'textarea', full: true },
  ];
}

export function render(el, rerender) {
  const ym = ui.month;
  const ativas = db.provisions.filter(p => p.status === 'ativa');

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Provisão mensal necessária', monthProvisions(ym), { sub: 'impacta o saldo livre real' }),
    statCard('Guardado neste mês', monthProvisionDeposits(ym), { tone: 'tone-ok' }),
    statCard('Total já provisionado', sum(db.provisions, p => p.valorAcumulado)),
    statCard('Provisões ativas', String(ativas.length))));

  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, 'Suas provisões'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Nova provisão', fields(), {}, vals => {
          add('provisions', { ...vals, status: 'ativa' });
          const mensal = provisionMonthly({ ...vals, status: 'ativa' }, ym);
          toast(`Provisão criada. Sugestão: guarde ${fmt(mensal)} por mês até ${ymLabel(vals.dataAlvo)}.`);
          rerender();
        }) }, '+ Nova provisão')),
    table([
      { label: 'Provisão', k: 'nome' },
      { label: 'Alvo', render: p => `${fmt(p.valorAlvo)} até ${p.dataAlvo ? ymLabel(p.dataAlvo) : '—'}` },
      { label: 'Mensal sugerido', render: p => fmt(provisionMonthly(p, ym)), right: true },
      { label: 'Acumulado', render: p => {
          const pct = p.valorAlvo > 0 ? Math.min(100, (p.valorAcumulado / p.valorAlvo) * 100) : 0;
          return h('div', { style: 'min-width:130px' },
            h('div', {}, `${fmt(p.valorAcumulado)} (${pct.toFixed(0)}%)`),
            h('div', { class: 'commit-meter', style: 'margin:4px 0 0' },
              h('div', { style: `width:${pct}%;background:${pct >= 100 ? '#7BC99A' : '#BFE8D5'}` })));
        } },
      { label: 'Status', render: p => {
          const atrasada = p.status === 'ativa' && p.dataAlvo && ymDiff(p.dataAlvo, ym) >= 0 &&
            p.valorAcumulado < esperadoAte(p, ym);
          return atrasada ? badge('atrasado') : badge(p.status);
        } },
      { label: '', render: p => rowActions(
          ['💰', () => depositModal(p, rerender), 'Registrar valor guardado'],
          ['✏️', () => formModal('Editar provisão', fields(), p, vals => { update('provisions', p.id, vals); rerender(); }), 'Editar'],
          [p.status === 'ativa' ? '⏸' : '▶️', () => { update('provisions', p.id, { status: p.status === 'ativa' ? 'pausada' : 'ativa' }); rerender(); }, p.status === 'ativa' ? 'Pausar' : 'Reativar'],
          ['🗑', () => confirmModal(`Excluir a provisão "${p.nome}"?`, () => { remove('provisions', p.id); rerender(); }), 'Excluir']), right: true },
    ], db.provisions, { empty: 'Nenhuma provisão. Crie provisões para IPVA, seguro, viagens e presentes — assim nada vira surpresa.', responsive: true })));
}

// Quanto deveria estar acumulado até este mês, mantendo o ritmo sugerido.
function esperadoAte(p, ym) {
  if (!p.dataAlvo) return 0;
  const restantes = Math.max(0, ymDiff(p.dataAlvo, ym));
  const mensal = provisionMonthly(p, ym);
  return Math.max(0, p.valorAlvo - mensal * restantes);
}

function depositModal(p, rerender) {
  formModal(`Guardar para "${p.nome}"`, [
    { k: 'valor', label: 'Valor guardado (R$)', type: 'money', required: true, value: Math.round(provisionMonthly(p, ui.month) * 100) / 100 },
    { k: 'mes', label: 'Mês', type: 'month', required: true, value: ui.month },
  ], {}, vals => {
    add('provisionDeposits', { provisaoId: p.id, mes: vals.mes, valor: vals.valor });
    const novoAcumulado = (Number(p.valorAcumulado) || 0) + vals.valor;
    update('provisions', p.id, {
      valorAcumulado: novoAcumulado,
      status: novoAcumulado >= p.valorAlvo ? 'concluida' : p.status,
    });
    toast(novoAcumulado >= p.valorAlvo ? 'Provisão concluída! 🎉' : 'Valor registrado na provisão.');
    rerender();
  }, { saveLabel: 'Registrar' });
}
