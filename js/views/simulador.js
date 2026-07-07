// Simulador de nova compra: impacto nos meses futuros antes de decidir.
import { h, fmt, fmtPct, ymNow, ymLabel, ymShort } from '../utils.js';
import { db } from '../store.js';
import { simulatePurchase, futureInstallmentsTotal } from '../calc.js';
import { card, table, alertBanner, statCard } from '../ui.js';
import { generateInstallments } from './cartoes.js';
import { add, save } from '../store.js';
import { toast } from '../ui.js';

const state = { valorTotal: '', numParcelas: 1, mesInicio: ymNow(), cartaoId: '', categoria: '', reembolsavel: false };

export function render(el, rerender) {
  const form = h('div', { class: 'form-grid' },
    field('Valor da compra (R$)', h('input', { type: 'number', step: '0.01', value: state.valorTotal, oninput: e => { state.valorTotal = Number(e.target.value); } })),
    field('Número de parcelas', h('input', { type: 'number', min: 1, value: state.numParcelas, oninput: e => { state.numParcelas = Math.max(1, Number(e.target.value)); } })),
    field('Mês de início', h('input', { type: 'month', value: state.mesInicio, oninput: e => { state.mesInicio = e.target.value; } })),
    field('Cartão', h('select', { onchange: e => { state.cartaoId = e.target.value; } },
      h('option', { value: '' }, 'Sem cartão / à vista'),
      db.cards.map(c => h('option', { value: c.id, selected: state.cartaoId === c.id }, c.nome)))),
    field('Categoria', h('select', { onchange: e => { state.categoria = e.target.value; } },
      h('option', { value: '' }, '—'),
      db.categoriesExpense.map(c => h('option', { value: c.nome, selected: state.categoria === c.nome }, c.nome)))));

  el.append(card('Simule antes de comprar', form,
    h('div', { class: 'modal-actions', style: 'justify-content:flex-start' },
      h('button', { class: 'btn btn-primary', onclick: rerender }, 'Simular impacto'))));

  if (!state.valorTotal || !state.mesInicio) {
    el.append(h('div', { class: 'empty-state' }, 'Preencha o valor e o mês de início para ver o impacto da compra.'));
    return;
  }

  const sim = simulatePurchase(state);
  const alerts = [];
  const negativo = sim.meses.find(m => m.saldoDepois < 0);
  if (negativo) alerts.push({ level: 'erro', msg: `Atenção: ${ymLabel(negativo.ym)} ficará com saldo livre negativo (${fmt(negativo.saldoDepois)}) se essa compra for confirmada.` });
  const estouraCartao = sim.meses.find(m => m.limiteCartao > 0 && m.faturaDepois > m.limiteCartao);
  if (estouraCartao) alerts.push({ level: 'aviso', msg: `Em ${ymLabel(estouraCartao.ym)}, a fatura ultrapassará o limite planejado do cartão (${fmt(estouraCartao.faturaDepois)} de ${fmt(estouraCartao.limiteCartao)}).` });
  const aporteMin = Number(db.settings.aporteMinimoMensal) || 0;
  const comprometeAporte = sim.meses.find(m => aporteMin > 0 && m.saldoDepois < 0 && m.saldoAntes >= 0);
  if (aporteMin > 0 && sim.meses.some(m => m.saldoDepois < aporteMin && m.saldoAntes >= aporteMin)) {
    alerts.push({ level: 'info', msg: `Essa compra pode comprometer seu aporte mínimo mensal de ${fmt(aporteMin)} em alguns meses.` });
  }
  if (!alerts.length) alerts.push({ level: 'info', msg: `Essa compra comprometerá ${fmt(sim.valorParcela)} por mês até ${ymLabel(sim.meses[sim.meses.length - 1].ym)}, sem deixar nenhum mês negativo.` });

  el.append(alertBanner(alerts));

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Valor da parcela', sim.valorParcela),
    statCard('Meses impactados', String(sim.meses.length)),
    statCard('Parcelamentos futuros após a compra', futureInstallmentsTotal(ymNow()) + Number(state.valorTotal))));

  el.append(card('Impacto mês a mês',
    table([
      { label: 'Mês', render: m => ymShort(m.ym) },
      { label: 'Parcela', render: m => fmt(m.valorParcela), right: true },
      { label: 'Saldo livre hoje', render: m => fmt(m.saldoAntes), right: true },
      { label: 'Saldo livre após', render: m => h('span', { style: m.saldoDepois < 0 ? 'color:var(--erro);font-weight:700' : 'color:#2E7D53;font-weight:600' }, fmt(m.saldoDepois)), right: true },
      { label: 'Comprometimento após', render: m => fmtPct(m.comprometimentoDepois), right: true },
      ...(state.cartaoId ? [
        { label: 'Fatura hoje', render: m => fmt(m.faturaAntes), right: true },
        { label: 'Fatura após', render: m => h('span', { style: m.limiteCartao > 0 && m.faturaDepois > m.limiteCartao ? 'color:var(--erro);font-weight:700' : '' }, fmt(m.faturaDepois)), right: true },
      ] : []),
    ], sim.meses)));

  if (state.cartaoId) {
    el.append(card(null, h('button', {
      class: 'btn btn-secondary', onclick: () => {
        const purchase = add('purchases', {
          descricao: `Compra simulada (${state.categoria || 'sem categoria'})`,
          dataCompra: new Date().toISOString().slice(0, 10),
          categoria: state.categoria, valorTotal: state.valorTotal,
          numParcelas: state.numParcelas, parcelaInicial: 1,
          valorParcela: sim.valorParcela, cartaoId: state.cartaoId,
          mesInicio: state.mesInicio, obs: 'Criada a partir do simulador',
        });
        db.installments.push(...generateInstallments(purchase));
        save();
        toast('Compra confirmada e parcelas distribuídas nos meses futuros.');
        location.hash = '#/cartoes';
      },
    }, '✓ Confirmar esta compra e criar as parcelas')));
  }
}

function field(label, input) {
  return h('label', { class: 'form-field' }, h('span', { class: 'form-label' }, label), input);
}
