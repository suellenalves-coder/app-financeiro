// Cálculos financeiros: agregados mensais, projeções e alertas.
import { db, PERIODICIDADES } from './store.js';
import { ymOf, ymAdd, ymDiff, ymNow, dateInMonth, daysUntil, sum, fmt, ymLabel } from './utils.js';

const ATIVAS = s => s !== 'cancelado' && s !== 'cancelada';

// ---- Receitas ----
// Receitas do mês: lançamentos com data no mês + projeção de receitas recorrentes
// (uma receita marcada como recorrente repete-se mensalmente a partir do seu mês).
export function monthIncomes(ym) {
  const direct = db.incomes.filter(i => ymOf(i.data) === ym && ATIVAS(i.status));
  const projected = db.incomes
    .filter(i => i.recorrente && ATIVAS(i.status) && ymDiff(ym, ymOf(i.data)) > 0)
    .filter(i => !db.incomes.some(o => o.recorrenteDe === i.id && ymOf(o.data) === ym))
    .map(i => ({
      ...i,
      id: `${i.id}@${ym}`,
      recorrenteDe: i.id,
      data: dateInMonth(ym, Number(i.data.slice(8, 10))),
      status: 'prevista',
      virtual: true,
    }));
  return [...direct, ...projected];
}

// ---- Despesas avulsas (não recorrentes, não parceladas) ----
export function monthExpenses(ym) {
  return db.expenses.filter(e => ymOf(e.dataVencimento || e.dataCompra) === ym && ATIVAS(e.status));
}

export function expenseNet(e) {
  return (Number(e.valorTotal) || 0) - (e.reembolsavel ? (Number(e.valorReembolsavel) || 0) : 0);
}

// ---- Contas recorrentes ----
export function recurringOccurrences(ym) {
  const out = [];
  for (const rec of db.recurring) {
    if (rec.status === 'pausada') continue;
    const start = rec.dataInicio || ymNow();
    if (ymDiff(ym, start) < 0) continue;
    if (rec.dataFim && ymDiff(ym, rec.dataFim) > 0) continue;
    const per = PERIODICIDADES.find(p => p[0] === rec.periodicidade)?.[2] || 1;
    if (ymDiff(ym, start) % per !== 0) continue;
    const key = `${rec.id}:${ym}`;
    const occ = db.recurringOcc[key] || {};
    if (occ.status === 'cancelado') continue;
    const dataVenc = dateInMonth(ym, Number(rec.diaVencimento) || 1);
    let status = occ.status || 'previsto';
    if (status === 'previsto' && daysUntil(dataVenc) < 0) status = 'vencido';
    out.push({
      key, rec, ym,
      nome: rec.nome,
      categoria: rec.categoria,
      valor: occ.valor !== undefined ? Number(occ.valor) : Number(rec.valorPrevisto) || 0,
      valorPago: Number(occ.valorPago) || 0,
      dataVencimento: dataVenc,
      status,
      dataPagamento: occ.dataPagamento || '',
    });
  }
  return out.sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
}

// ---- Parcelamentos ----
export function monthInstallments(ym) {
  return db.installments.filter(p => p.mes === ym && ATIVAS(p.status));
}

// Valor da parcela já descontada a fatia mensal do reembolso da compra (se reembolsável).
// A fatura do cartão continua bruta (cardInvoice) — isso só vale para o orçamento/despesa real.
export function installmentNet(p) {
  const compra = db.purchases.find(c => c.id === p.purchaseId);
  if (!compra?.reembolsavel || !Number(compra.valorReembolsavel)) return Number(p.valor) || 0;
  const totalParcelas = Number(compra.numParcelas) || 1;
  const reembolsoPorParcela = Number(compra.valorReembolsavel) / totalParcelas;
  return Math.max(0, (Number(p.valor) || 0) - reembolsoPorParcela);
}

export function futureInstallmentsTotal(fromYm) {
  return sum(db.installments.filter(p => ymDiff(p.mes, fromYm) > 0 && ATIVAS(p.status)), p => p.valor);
}

// Fatura de um cartão no mês: parcelas de compras parceladas + despesas avulsas pagas
// no cartão (ex.: abastecimentos), para não precisar olhar em dois lugares.
export function cardInvoice(cardId, ym) {
  const parcelas = monthInstallments(ym).filter(p => p.cartaoId === cardId);
  const despesas = monthExpenses(ym).filter(e => e.cartaoId === cardId && e.formaPagamento === 'Cartão de crédito');
  const novas = parcelas.filter(p => Number(p.numero) === Number(p.parcelaInicial ?? 1) &&
    db.purchases.find(c => c.id === p.purchaseId)?.mesInicio === ym);
  const herdadas = parcelas.filter(p => !novas.includes(p));
  return {
    parcelas, despesas,
    total: sum(parcelas, p => p.valor) + sum(despesas, e => e.valorTotal),
    pago: sum(parcelas.filter(p => p.status === 'pago'), p => p.valor) + sum(despesas.filter(e => e.status === 'pago'), e => e.valorTotal),
    novas: sum(novas, p => p.valor) + sum(despesas, e => e.valorTotal),
    herdadas: sum(herdadas, p => p.valor),
  };
}

// ---- Provisões ----
// Valor mensal necessário para atingir o alvo até a data alvo.
export function provisionMonthly(prov, ym = ymNow()) {
  if (prov.status !== 'ativa') return 0;
  if (prov.dataAlvo && ymDiff(prov.dataAlvo, ym) < 0) return 0;
  if (prov.valorMensal) return Number(prov.valorMensal);
  const restante = Math.max(0, (Number(prov.valorAlvo) || 0) - (Number(prov.valorAcumulado) || 0));
  const meses = prov.dataAlvo ? Math.max(1, ymDiff(prov.dataAlvo, ym) + 1) : 12;
  return restante / meses;
}

export function monthProvisions(ym) {
  return sum(db.provisions, p => provisionMonthly(p, ym));
}

export function monthProvisionDeposits(ym) {
  return sum(db.provisionDeposits.filter(d => d.mes === ym), d => d.valor);
}

// ---- Investimentos ----
export function monthInvestPlanned() {
  return sum(db.investments, i => i.aporteMensalPlanejado);
}

export function monthInvestDone(ym) {
  return sum(db.investContrib.filter(c => ymOf(c.data) === ym), c => c.valor);
}

export function totalInvested() {
  return sum(db.investments, i => i.valorAtual);
}

export function reserveTotal() {
  return sum(db.investments.filter(i => i.tipo === 'Reserva de emergência' || i.objetivo === 'Reserva de emergência'), i => i.valorAtual);
}

export function monthInvestRedemptions(ym) {
  return db.investRedemptions.filter(r => ymOf(r.data) === ym);
}

// ---- Contas bancárias ----
// Saldo sempre calculado ao vivo a partir do saldo inicial + receitas recebidas +
// despesas pagas vinculadas à conta + conciliações manuais — nunca um campo solto que
// possa dessincronizar (edição/duplicação/exclusão de lançamentos refletem na hora).
export function accountBalance(contaId) {
  const conta = db.accounts.find(a => a.id === contaId);
  if (!conta) return 0;
  const recebido = sum(db.incomes.filter(i => i.contaId === contaId && i.status === 'recebida'), i => i.valor);
  const pago = sum(db.expenses.filter(e => e.contaId === contaId && e.status === 'pago'), e => e.valorTotal);
  const ajustes = sum(db.accountAdjustments.filter(a => a.contaId === contaId), a => a.valor);
  return (Number(conta.saldoInicial) || 0) + recebido - pago + ajustes;
}

// ---- Orçamento por categoria ----
// As 3 categorias que mais pesaram no mês, comparadas ao mês anterior.
export function topCategoriesComparison(ym) {
  const anterior = Object.fromEntries(expensesByCategory(ymAdd(ym, -1)));
  return expensesByCategory(ym).slice(0, 3).map(([categoria, valor]) => ({
    categoria, valor,
    valorAnterior: anterior[categoria] || 0,
    delta: valor - (anterior[categoria] || 0),
  }));
}

// ---- Reembolsos ----
export function reimbPending(r) {
  return Math.max(0, (Number(r.valorAReembolsar) || 0) - (Number(r.valorRecebido) || 0));
}

// Mês de competência do reembolso: explícito (parcelas de cartão, uma por mês)
// ou derivado da data (reembolsos avulsos/de despesa, que valem só naquele mês).
export function reimbMonth(r) {
  return r.mes || ymOf(r.data);
}

export function reimbOutstanding() {
  return sum(db.reimbursements.filter(r => ['pendente', 'solicitado', 'parcial', 'atrasado'].includes(r.status)), reimbPending);
}

export function monthReimbursements(ym) {
  return db.reimbursements.filter(r => ymOf(r.data) === ym && ATIVAS(r.status));
}

// ---- Resumo mensal consolidado ----
export function monthSummary(ym) {
  const incomes = monthIncomes(ym);
  const receitaTotal = sum(incomes, i => i.valor);
  const receitaSegura = sum(incomes.filter(i => i.tipo === 'segura'), i => i.valor);
  const receitaVariavel = sum(incomes.filter(i => i.tipo === 'variavel'), i => i.valor);

  const expenses = monthExpenses(ym);
  const fixas = expenses.filter(e => e.natureza === 'fixa');
  const variaveis = expenses.filter(e => e.natureza !== 'fixa');
  const despFixasAvulsas = sum(fixas, expenseNet);
  const despVariaveis = sum(variaveis, expenseNet);

  const recs = recurringOccurrences(ym);
  const recorrentes = sum(recs, o => o.valor);

  const parcelas = monthInstallments(ym);
  const parcelamentos = sum(parcelas, installmentNet);

  const provisoes = monthProvisions(ym);
  const investimentos = monthInvestPlanned();
  const investRealizado = monthInvestDone(ym);

  const reembolsosMes = sum(monthReimbursements(ym), reimbPending);

  const despesasFixas = despFixasAvulsas + recorrentes;
  const despesasTotais = despesasFixas + despVariaveis + parcelamentos;

  const compromissos = despesasFixas + parcelamentos + provisoes + investimentos + despVariaveis;
  const saldoPrevisto = receitaTotal - despesasTotais - provisoes - investimentos;
  const saldoLivreReal = receitaSegura - compromissos;
  const comprometimento = receitaSegura > 0
    ? ((despesasFixas + parcelamentos + provisoes + investimentos) / receitaSegura) * 100
    : 0;

  return {
    ym, incomes, expenses, recs, parcelas,
    receitaTotal, receitaSegura, receitaVariavel,
    despesasTotais, despesasFixas, despVariaveis, despFixasAvulsas, recorrentes,
    parcelamentos, provisoes, investimentos, investRealizado,
    reembolsosMes, reembolsosAReceber: reimbOutstanding(),
    saldoPrevisto, saldoLivreReal, comprometimento,
  };
}

// Divisão do comprometimento da renda para o gráfico de barras empilhadas.
export function commitmentBreakdown(ym) {
  const s = monthSummary(ym);
  const dividas = sum(s.expenses.filter(e => e.categoria === 'Dívidas'), expenseNet) +
    sum(s.recs.filter(o => o.categoria === 'Dívidas'), o => o.valor);
  const fixas = Math.max(0, s.despesasFixas - dividas);
  const livre = Math.max(0, s.receitaSegura - s.despesasFixas - s.parcelamentos - s.provisoes - s.investimentos);
  return {
    receitaSegura: s.receitaSegura,
    partes: [
      ['Despesas fixas', fixas],
      ['Dívidas', dividas],
      ['Parcelamentos', s.parcelamentos],
      ['Provisões', s.provisoes],
      ['Investimentos', s.investimentos],
      ['Livre', livre],
    ],
  };
}

// Despesas por categoria (líquidas), incluindo recorrentes e parcelas.
export function expensesByCategory(ym) {
  const map = {};
  const addTo = (cat, v) => { map[cat || 'Sem categoria'] = (map[cat || 'Sem categoria'] || 0) + v; };
  for (const e of monthExpenses(ym)) addTo(e.categoria, expenseNet(e));
  for (const o of recurringOccurrences(ym)) addTo(o.categoria, o.valor);
  for (const p of monthInstallments(ym)) {
    const compra = db.purchases.find(c => c.id === p.purchaseId);
    addTo(compra?.categoria, installmentNet(p));
  }
  return Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

// Linha anual: uma entrada por mês do ano.
export function annualRows(year) {
  return Array.from({ length: 12 }, (_, i) => monthSummary(`${year}-${String(i + 1).padStart(2, '0')}`));
}

// ---- Alertas automáticos ----
export function alertsFor(ym) {
  const s = monthSummary(ym);
  const alerts = [];
  const push = (level, msg) => alerts.push({ level, msg });

  if (s.receitaSegura > 0) {
    if (s.comprometimento > 85) push('erro', `Atenção: ${s.comprometimento.toFixed(0)}% da sua renda segura já está comprometida neste mês.`);
    else if (s.comprometimento > 70) push('aviso', `${s.comprometimento.toFixed(0)}% da sua renda segura já está comprometida neste mês.`);
  }
  if (s.saldoLivreReal < 0) push('erro', `Seu saldo livre real está negativo em ${fmt(Math.abs(s.saldoLivreReal))} em ${ymLabel(ym)}.`);

  const vencidas = [
    ...s.expenses.filter(e => e.status === 'vencido' || (e.status === 'previsto' && e.dataVencimento && daysUntil(e.dataVencimento) < 0)),
    ...s.recs.filter(o => o.status === 'vencido'),
  ];
  if (vencidas.length) push('erro', `Você tem ${vencidas.length} conta${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''} sem pagamento registrado.`);

  const vencendo = [...s.expenses.filter(e => e.status === 'previsto' && e.dataVencimento), ...s.recs.filter(o => o.status === 'previsto')]
    .filter(x => { const d = daysUntil(x.dataVencimento); return d >= 0 && d <= 3; });
  if (vencendo.length) push('aviso', `${vencendo.length} conta${vencendo.length > 1 ? 's vencem' : ' vence'} nos próximos 3 dias.`);

  const semCategoria = s.expenses.filter(e => !e.categoria).length;
  if (semCategoria) push('aviso', `Você ainda tem ${semCategoria} despesa${semCategoria > 1 ? 's' : ''} sem categoria.`);

  // Faturas de cartão
  for (const card of db.cards) {
    const inv = cardInvoice(card.id, ym);
    if (card.limitePlanejado > 0 && inv.total > card.limitePlanejado) {
      push('aviso', `A fatura do cartão ${card.nome} (${fmt(inv.total)}) ultrapassou o limite planejado de ${fmt(card.limitePlanejado)}.`);
    } else if (card.limitePlanejado > 0 && inv.total > card.limitePlanejado * 0.8) {
      push('info', `A fatura do cartão ${card.nome} já atingiu ${Math.round(inv.total / card.limitePlanejado * 100)}% do limite planejado para este mês.`);
    }
  }

  // Parcelamentos futuros acima do limite definido
  const limPct = Number(db.settings.limiteParcelamentosPct) || 0;
  if (limPct > 0 && s.receitaSegura > 0) {
    for (let i = 1; i <= 6; i++) {
      const m = ymAdd(ym, i);
      const val = sum(monthInstallments(m), installmentNet);
      if (val > s.receitaSegura * limPct / 100) {
        push('aviso', `Em ${ymLabel(m)}, os parcelamentos (${fmt(val)}) ultrapassam ${limPct}% da renda segura atual.`);
        break;
      }
    }
  }

  // Reserva abaixo da meta
  const reserva = reserveTotal();
  if (db.settings.metaReservaMin > 0 && reserva < db.settings.metaReservaMin) {
    push('aviso', `Sua reserva (${fmt(reserva)}) está abaixo da meta mínima de ${fmt(db.settings.metaReservaMin)}.`);
  }

  // Reembolsos parados
  const hoje = new Date();
  for (const r of db.reimbursements) {
    if (['pendente', 'solicitado', 'parcial'].includes(r.status) && r.data) {
      const dias = Math.round((hoje - new Date(r.data)) / 86400000);
      if (dias > 15) {
        const pessoa = db.people.find(p => p.id === r.pessoaId);
        push('info', `Reembolso de ${fmt(reimbPending(r))}${pessoa ? ` de ${pessoa.nome}` : ''} está pendente há ${dias} dias.`);
        break;
      }
    }
  }

  // Investimento planejado não realizado (apenas para meses passados ou o atual, no fim do mês)
  if (ymDiff(ym, ymNow()) < 0 && s.investimentos > 0 && s.investRealizado < s.investimentos) {
    push('info', `Em ${ymLabel(ym)}, o aporte realizado (${fmt(s.investRealizado)}) ficou abaixo do planejado (${fmt(s.investimentos)}).`);
  }

  return alerts;
}

// Simulação de compra parcelada: impacto mês a mês.
export function simulatePurchase({ valorTotal, numParcelas, mesInicio, cartaoId }) {
  const valorParcela = (Number(valorTotal) || 0) / Math.max(1, Number(numParcelas) || 1);
  const meses = [];
  for (let i = 0; i < numParcelas; i++) {
    const m = ymAdd(mesInicio, i);
    const s = monthSummary(m);
    const card = cartaoId ? db.cards.find(c => c.id === cartaoId) : null;
    const fatura = card ? cardInvoice(card.id, m).total : 0;
    meses.push({
      ym: m,
      valorParcela,
      saldoAntes: s.saldoLivreReal,
      saldoDepois: s.saldoLivreReal - valorParcela,
      comprometimentoAntes: s.comprometimento,
      comprometimentoDepois: s.receitaSegura > 0
        ? s.comprometimento + (valorParcela / s.receitaSegura) * 100 : 0,
      faturaAntes: fatura,
      faturaDepois: fatura + valorParcela,
      limiteCartao: card ? Number(card.limitePlanejado) || 0 : 0,
    });
  }
  return { valorParcela, meses };
}

// ---- Abastecimentos (método tanque cheio-a-cheio) ----
// Cada abastecimento a partir do segundo forma um "trecho" com o anterior: a distância
// rodada (diferença de km) e os litros daquele abastecimento cobrem esse trecho. O primeiro
// abastecimento só estabelece a base (sem trecho anterior para comparar).
function refuelingSegments() {
  const sorted = [...db.refuelings]
    .filter(r => Number(r.kmRegistrado) > 0 && Number(r.litros) > 0)
    .sort((a, b) => (Number(a.kmRegistrado) - Number(b.kmRegistrado)) || (a.data || '').localeCompare(b.data || ''));
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    const km = Number(cur.kmRegistrado) - Number(prev.kmRegistrado);
    const litros = Number(cur.litros) || 0;
    if (km <= 0) continue; // km não avançou (registro incorreto) — ignora o trecho
    out.push({ data: cur.data, km, litros, valor: Number(cur.valorTotal) || 0 });
  }
  return out;
}

// Indicadores de combustível para um conjunto de meses (ym[]): valor gasto (todos os
// abastecimentos com data no período), consumo médio e custo por km (trechos que terminam
// no período, método cheio-a-cheio).
export function carFuelStats(meses) {
  const set = new Set(meses);
  const valorGasto = sum(db.refuelings.filter(r => set.has(ymOf(r.data))), r => Number(r.valorTotal) || 0);
  const segs = refuelingSegments().filter(s => set.has(ymOf(s.data)));
  const km = sum(segs, s => s.km);
  const litros = sum(segs, s => s.litros);
  return {
    valorGasto, km,
    consumoMedio: litros > 0 ? km / litros : null,
    custoPorKm: km > 0 ? valorGasto / km : null,
  };
}
