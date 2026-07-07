// Fechamento mensal guiado: checklist, indicadores e diagnóstico automático.
import { h, fmt, ymLabel, ymAdd, ymDiff, sum, ymOf } from '../utils.js';
import { db, ui } from '../store.js';
import {
  monthSummary, monthExpenses, monthIncomes, recurringOccurrences, monthInstallments,
  expenseNet, monthInvestDone, monthProvisionDeposits, reimbPending, cardInvoice,
} from '../calc.js';
import { card, statCard, table } from '../ui.js';

export function render(el) {
  const ym = ui.month;
  const s = monthSummary(ym);

  // ---- Checklist ----
  const receitasPendentes = s.incomes.filter(i => i.status === 'prevista' || i.status === 'atrasada');
  const recorrentesAbertas = s.recs.filter(o => o.status !== 'pago');
  const semCategoria = s.expenses.filter(e => !e.categoria);
  const semResponsavel = s.expenses.filter(e => e.reembolsavel && !e.pessoaId);
  const reembolsosPendentes = db.reimbursements.filter(r => ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status));
  const vencidas = [...s.expenses.filter(e => e.status === 'vencido'), ...s.recs.filter(o => o.status === 'vencido')];
  const faturasAbertas = db.cards.filter(c => { const inv = cardInvoice(c.id, ym); return inv.total > 0 && inv.pago < inv.total; });
  const investFeito = s.investRealizado >= s.investimentos;
  const provFeitas = monthProvisionDeposits(ym) >= s.provisoes - 0.01;
  const novasParcelas = db.purchases.filter(p => p.mesInicio === ym);
  const valorNovasParcelas = sum(novasParcelas, p => Number(p.valorParcela) || 0);

  const checklist = [
    [!receitasPendentes.length, 'Todas as receitas previstas foram recebidas?', receitasPendentes.length ? `${receitasPendentes.length} receita(s) ainda em aberto (${fmt(sum(receitasPendentes, i => i.valor))}).` : 'Sim.'],
    [!recorrentesAbertas.length, 'Todas as contas recorrentes foram pagas?', recorrentesAbertas.length ? `${recorrentesAbertas.length} conta(s) sem pagamento confirmado.` : 'Sim.'],
    [!faturasAbertas.length, 'Todas as faturas foram conferidas e quitadas?', faturasAbertas.length ? `Faturas em aberto: ${faturasAbertas.map(c => c.nome).join(', ')}.` : 'Sim.'],
    [!semCategoria.length, 'Todas as despesas estão categorizadas?', semCategoria.length ? `Você ainda tem ${semCategoria.length} despesa(s) sem categoria.` : 'Sim.'],
    [!semResponsavel.length, 'Existem despesas reembolsáveis sem pessoa vinculada?', semResponsavel.length ? `${semResponsavel.length} despesa(s) reembolsável(is) sem pessoa.` : 'Não, tudo vinculado.'],
    [!reembolsosPendentes.length, 'Existem reembolsos pendentes?', reembolsosPendentes.length ? `${fmt(sum(reembolsosPendentes, reimbPending))} ainda a receber.` : 'Não.'],
    [!vencidas.length, 'Existem contas vencidas?', vencidas.length ? `${vencidas.length} conta(s) vencida(s).` : 'Não.'],
    [investFeito, 'Os investimentos planejados foram feitos?', investFeito ? 'Sim.' : `Aportado ${fmt(s.investRealizado)} de ${fmt(s.investimentos)} planejados.`],
    [provFeitas, 'As provisões foram cumpridas?', provFeitas ? 'Sim.' : `Guardado ${fmt(monthProvisionDeposits(ym))} de ${fmt(s.provisoes)} planejados.`],
    [!novasParcelas.length, 'Alguma compra parcelada nova impactou os próximos meses?', novasParcelas.length ? `${novasParcelas.length} compra(s) nova(s): +${fmt(valorNovasParcelas)}/mês nos próximos meses.` : 'Não.'],
  ];

  el.append(card(`Checklist de fechamento · ${ymLabel(ym)}`,
    checklist.map(([ok, pergunta, detalhe]) => h('div', { class: 'check-item' },
      h('span', { class: 'check-mark' }, ok ? '✅' : '⚠️'),
      h('div', {}, h('b', {}, pergunta), h('div', { class: 'stat-sub' }, detalhe))))));

  // ---- Indicadores ----
  const receitaRealizada = sum(s.incomes.filter(i => i.status === 'recebida'), i => i.valor);
  const despesaRealizada =
    sum(s.expenses.filter(e => ['pago', 'reembolsado', 'parcial'].includes(e.status)), e => e.valorTotal) +
    sum(s.recs.filter(o => o.status === 'pago'), o => o.valor) +
    sum(s.parcelas.filter(p => p.status === 'pago'), p => p.valor);
  const despesaLiquida =
    sum(s.expenses.filter(e => ['pago', 'reembolsado', 'parcial'].includes(e.status)), expenseNet) +
    sum(s.recs.filter(o => o.status === 'pago'), o => o.valor) +
    sum(s.parcelas.filter(p => p.status === 'pago'), p => p.valor);
  const saldoFinal = receitaRealizada - despesaRealizada - monthInvestDone(ym) - monthProvisionDeposits(ym);
  const diferenca = saldoFinal - s.saldoPrevisto;

  el.append(h('div', { class: 'grid grid-cards' },
    statCard('Receita realizada', receitaRealizada),
    statCard('Despesa realizada (bruta)', despesaRealizada),
    statCard('Despesa líquida real', despesaLiquida, { tone: 'tone-accent', sub: 'descontando reembolsos' }),
    statCard('Investido no mês', monthInvestDone(ym)),
    statCard('Provisionado no mês', monthProvisionDeposits(ym)),
    statCard('Reembolsos pendentes', sum(reembolsosPendentes, reimbPending), { tone: reembolsosPendentes.length ? 'tone-warn' : '' }),
    statCard('Novas parcelas criadas', valorNovasParcelas, { sub: novasParcelas.length ? `${novasParcelas.length} compra(s)` : '' }),
    statCard('Saldo final do mês', saldoFinal, { tone: saldoFinal < 0 ? 'tone-bad' : 'tone-ok' }),
    statCard('Planejado × realizado', `${diferenca >= 0 ? '+' : ''}${fmt(diferenca)}`, { tone: diferenca >= 0 ? 'tone-ok' : 'tone-warn', sub: 'diferença sobre o saldo previsto' })));

  // ---- Diagnóstico automático ----
  el.append(card('Diagnóstico do mês', h('p', { style: 'line-height:1.7' }, diagnostico(ym, s, { saldoFinal, diferenca, despesaLiquida, novasParcelas, valorNovasParcelas }))));
}

function diagnostico(ym, s, extra) {
  const frases = [];
  const { saldoFinal, diferenca, novasParcelas, valorNovasParcelas } = extra;

  if (Math.abs(diferenca) < 1) frases.push(`Seu mês fechou exatamente como o planejado.`);
  else if (diferenca > 0) frases.push(`Seu mês fechou ${fmt(diferenca)} acima do planejado.`);
  else frases.push(`Seu mês fechou ${fmt(Math.abs(diferenca))} abaixo do planejado.`);

  // Maiores categorias de gasto variável
  const porCat = {};
  for (const e of s.expenses.filter(e => e.natureza !== 'fixa')) {
    porCat[e.categoria || 'Sem categoria'] = (porCat[e.categoria || 'Sem categoria'] || 0) + expenseNet(e);
  }
  const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, v]) => v > 0);
  if (top.length) frases.push(`O maior peso dos gastos variáveis veio de ${top.map(([c, v]) => `${c} (${fmt(v)})`).join(' e ')}.`);

  if (novasParcelas.length) {
    const fim = novasParcelas.map(p => ymAdd(p.mesInicio, Number(p.numParcelas) - Number(p.parcelaInicial || 1))).sort().pop();
    frases.push(`Os parcelamentos novos aumentaram os compromissos em ${fmt(valorNovasParcelas)} por mês até ${ymLabel(fim)}.`);
  }

  if (s.comprometimento > 85) frases.push(`Atenção: ${s.comprometimento.toFixed(0)}% da renda segura está comprometida — acima do nível recomendado.`);
  else if (s.comprometimento > 70) frases.push(`O comprometimento da renda ficou em ${s.comprometimento.toFixed(0)}%, um pouco acima do confortável.`);
  else if (s.receitaSegura > 0) frases.push(`O comprometimento da renda ficou em ${s.comprometimento.toFixed(0)}%, dentro de um nível saudável.`);

  if (s.saldoLivreReal < 0) frases.push(`O saldo livre real terminou negativo em ${fmt(Math.abs(s.saldoLivreReal))} — vale rever gastos variáveis do próximo mês.`);
  else if (saldoFinal >= 0) frases.push(`A reserva financeira foi preservada.`);

  const investOk = s.investRealizado >= s.investimentos;
  if (s.investimentos > 0 && !investOk) frases.push(`Os aportes ficaram ${fmt(s.investimentos - s.investRealizado)} abaixo do planejado.`);

  return frases.join(' ');
}
