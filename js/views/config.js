// Configurações: metas, categorias, bancos, pessoas, regras e dados.
import { h, fmt, downloadFile, todayISO, ymNow, ymAdd, uid } from '../utils.js';
import { db, save, add, update, remove, resetAll } from '../store.js';
import { card, table, formModal, confirmModal, rowActions, toast, badge } from '../ui.js';
import { generateInstallments } from './cartoes.js';
import { addCard } from './cartoes.js';

export function render(el, rerender) {
  // ---- Metas financeiras ----
  const metas = [
    ['rendaSegura', 'Renda segura mensal (referência)'],
    ['limiteComprometimento', 'Limite de comprometimento da renda (%)'],
    ['limiteParcelamentosPct', 'Limite de parcelamentos sobre a renda segura (%)'],
    ['metaReservaMin', 'Reserva mínima desejada (R$)'],
    ['metaReservaMax', 'Reserva ideal (R$)'],
    ['aporteMinimoMensal', 'Aporte mínimo mensal (R$)'],
    ['limiteLazer', 'Limite máximo de Lazer (R$/mês)'],
    ['limiteAlimentacaoFora', 'Limite de Alimentação fora de casa (R$/mês)'],
    ['saldoMinimoSeguranca', 'Saldo mínimo de segurança em conta (R$)'],
  ];
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '🎯 Metas financeiras'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Editar metas', metas.map(([k, label]) => ({ k, label, type: 'money' })), { ...db.settings }, vals => {
          Object.assign(db.settings, vals); save(); toast('Metas atualizadas.'); rerender();
        }) }, 'Editar metas')),
    table([
      { label: 'Meta', render: m => m[1] },
      { label: 'Valor', render: m => {
          const v = Number(db.settings[m[0]]) || 0;
          return m[0].includes('Pct') || m[0] === 'limiteComprometimento' ? `${v}%` : fmt(v);
        }, right: true },
    ], metas)));

  // ---- Pessoas para reembolso ----
  const pessoaFields = [
    { k: 'nome', label: 'Nome', type: 'text', required: true },
    { k: 'relacao', label: 'Relação', type: 'text', placeholder: 'Ex.: irmão, marido…' },
    { k: 'contato', label: 'WhatsApp (com DDD e país)', type: 'text', placeholder: '5521999999999', help: 'Usado no botão "Abrir no WhatsApp".' },
  ];
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '👤 Pessoas para reembolso'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Nova pessoa', pessoaFields, {}, vals => { add('people', { ...vals, ativo: true }); rerender(); }) }, '+ Nova pessoa')),
    table([
      { label: 'Nome', k: 'nome' },
      { label: 'Relação', k: 'relacao' },
      { label: 'Contato', k: 'contato' },
      { label: '', render: p => rowActions(
          ['✏️', () => formModal('Editar pessoa', pessoaFields, p, vals => { update('people', p.id, vals); rerender(); }), 'Editar'],
          ['🗑', () => confirmModal(`Excluir ${p.nome}? Os reembolsos vinculados serão mantidos sem pessoa.`, () => { remove('people', p.id); rerender(); }), 'Excluir']), right: true },
    ], db.people, { empty: 'Cadastre as pessoas que devem reembolsos (irmão, marido…).' })));

  // ---- Bancos ----
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '🏦 Bancos'),
      h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
          formModal('Novo banco', [{ k: 'nome', label: 'Nome do banco', type: 'text', required: true }], {}, vals => { add('banks', vals); rerender(); }) }, '+ Banco'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => addCard(rerender) }, '+ Cartão'))),
    table([
      { label: 'Banco', k: 'nome' },
      { label: 'Cartões vinculados', render: b => db.cards.filter(c => c.banco === b.nome).map(c => c.nome).join(', ') || '—' },
      { label: '', render: b => rowActions(['🗑', () => confirmModal(`Excluir o banco ${b.nome}?`, () => { remove('banks', b.id); rerender(); }), 'Excluir']), right: true },
    ], db.banks)));

  // ---- Categorias ----
  const catFields = [
    { k: 'nome', label: 'Nome da categoria', type: 'text', required: true },
    { k: 'subTexto', label: 'Subcategorias (separadas por vírgula)', type: 'text', full: true },
  ];
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '🏷️ Categorias de despesa'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Nova categoria', catFields, {}, vals => {
          add('categoriesExpense', { nome: vals.nome, sub: (vals.subTexto || '').split(',').map(s => s.trim()).filter(Boolean) });
          rerender();
        }) }, '+ Categoria')),
    table([
      { label: 'Categoria', k: 'nome' },
      { label: 'Subcategorias', render: c => (c.sub || []).join(', ') || '—' },
      { label: '', render: c => rowActions(
          ['✏️', () => formModal('Editar categoria', catFields, { ...c, subTexto: (c.sub || []).join(', ') }, vals => {
            update('categoriesExpense', c.id, { nome: vals.nome, sub: (vals.subTexto || '').split(',').map(s => s.trim()).filter(Boolean) });
            rerender();
          }), 'Editar'],
          ['🗑', () => confirmModal(`Excluir a categoria ${c.nome}?`, () => { remove('categoriesExpense', c.id); rerender(); }), 'Excluir']), right: true },
    ], db.categoriesExpense)));

  // ---- Regras automáticas de categorização ----
  const ruleFields = [
    { k: 'contem', label: 'Se a descrição contém…', type: 'text', required: true, placeholder: 'Ex.: posto, ifood, uber' },
    { k: 'acao', label: 'Então…', type: 'select', required: true, value: 'categoria',
      options: [['categoria', 'Sugerir categoria'], ['pessoa', 'Sugerir pessoa para reembolso']] },
    { k: 'valor', label: 'Valor sugerido', type: 'text', required: true, help: 'Nome da categoria ou da pessoa.' },
  ];
  el.append(card(null,
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '⚡ Regras automáticas de categorização'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () =>
        formModal('Nova regra', ruleFields, {}, vals => { add('rules', vals); rerender(); }) }, '+ Regra')),
    table([
      { label: 'Se contém', render: r => h('code', {}, r.contem) },
      { label: 'Ação', render: r => r.acao === 'pessoa' ? 'Sugerir pessoa' : 'Sugerir categoria' },
      { label: 'Valor', k: 'valor' },
      { label: '', render: r => rowActions(
          ['✏️', () => formModal('Editar regra', ruleFields, r, vals => { update('rules', r.id, vals); rerender(); }), 'Editar'],
          ['🗑', () => confirmModal('Excluir esta regra?', () => { remove('rules', r.id); rerender(); }), 'Excluir']), right: true },
    ], db.rules, { empty: 'Nenhuma regra. As regras aceleram o cadastro sugerindo categorias automaticamente.' })));

  // ---- Dados ----
  el.append(card('💾 Dados',
    h('p', { class: 'stat-sub' }, 'Seus dados ficam salvos apenas neste navegador (localStorage). Faça backup regularmente.'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn btn-secondary btn-sm', onclick: () =>
        downloadFile(`meu-orcamento-backup-${todayISO()}.json`, JSON.stringify(db, null, 2), 'application/json') }, '⬇ Exportar backup (JSON)'),
      (() => {
        const input = h('input', { type: 'file', accept: '.json', style: 'display:none' });
        input.addEventListener('change', () => {
          const file = input.files[0];
          if (!file) return;
          file.text().then(t => {
            try {
              const data = JSON.parse(t);
              if (!data.settings) throw new Error('formato inválido');
              Object.assign(db, data); save();
              toast('Backup restaurado.'); rerender();
            } catch { toast('Arquivo inválido. Use um backup exportado pelo app.'); }
          });
        });
        return h('span', {}, input, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => input.click() }, '⬆ Restaurar backup'));
      })(),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => loadSample(rerender) }, '✨ Carregar dados de exemplo'),
      h('button', { class: 'btn btn-danger btn-sm', onclick: () =>
        confirmModal('Apagar TODOS os dados e recomeçar do zero? Esta ação não pode ser desfeita.', () => { resetAll(); location.reload(); }) }, '🗑 Apagar tudo'))));
}

// Dados de exemplo para conhecer o app.
function loadSample(rerender) {
  confirmModal('Carregar dados de exemplo? Eles serão somados aos seus dados atuais.', doLoad, { yesLabel: 'Carregar', danger: false });
  function doLoad() {
    const ym = ymNow();
    const p1 = add('people', { nome: 'Irmão', relacao: 'irmão', contato: '', ativo: true });
    const cartao = add('cards', { nome: 'Cartão Principal', banco: 'Santander', diaFechamento: 28, diaVencimento: 8, limitePlanejado: 2500, ativo: true });

    if (!db.incomes.length) {
      add('incomes', { data: `${ym}-05`, descricao: 'Salário', categoria: 'Salário fixo', valor: 8500, tipo: 'segura', status: 'recebida', recorrente: true });
    }
    add('incomes', { data: `${ym}-15`, descricao: 'Aula de pós-graduação', categoria: 'Aula ou docência', valor: 1200, tipo: 'variavel', status: 'prevista' });

    for (const [nome, categoria, valor, dia] of [
      ['Aluguel', 'Moradia', 2200, 10], ['Condomínio', 'Condomínio', 650, 10],
      ['Luz', 'Luz', 180, 15], ['Internet', 'Internet, TV e celular', 120, 20],
      ['Financiamento do carro', 'Dívidas', 890, 12], ['Streaming', 'Assinaturas', 55, 5],
    ]) {
      add('recurring', { nome, categoria, valorPrevisto: valor, diaVencimento: dia, periodicidade: 'mensal', dataInicio: ymAdd(ym, -3), dataFim: '', formaPagamento: 'Débito automático', banco: 'Santander', status: 'ativa', obs: '' });
    }

    const compra = add('purchases', { descricao: 'Passagens de avião', dataCompra: todayISO(), categoria: 'Viagem', valorTotal: 1800, numParcelas: 6, parcelaInicial: 1, valorParcela: 300, cartaoId: cartao.id, mesInicio: ym, responsavel: '', reembolsavel: false, obs: 'exemplo' });
    db.installments.push(...generateInstallments(compra));

    const mercado = add('expenses', { dataCompra: `${ym}-08`, dataVencimento: `${ym}-08`, descricao: 'Mercado da semana', categoria: 'Mercado', valorTotal: 420, formaPagamento: 'Débito', banco: 'Santander', natureza: 'variavel', status: 'pago', dataPagamento: `${ym}-08` });
    const jantar = add('expenses', { dataCompra: `${ym}-14`, dataVencimento: `${ym}-14`, descricao: 'Jantar em família', categoria: 'Alimentação fora de casa', valorTotal: 300, formaPagamento: 'Pix', natureza: 'variavel', status: 'pago', dataPagamento: `${ym}-14`, reembolsavel: true, pessoaId: p1.id, valorReembolsavel: 150 });
    add('reimbursements', { expenseId: jantar.id, pessoaId: p1.id, descricao: 'Jantar em família', data: `${ym}-14`, categoria: 'Alimentação fora de casa', valorTotalDespesa: 300, criterio: 'igual', valorAReembolsar: 150, valorRecebido: 0, status: 'pendente', dataSolicitacao: '', dataRecebimento: '', obs: '' });

    add('provisions', { nome: 'IPVA 2027', categoria: 'Impostos', valorAlvo: 2400, dataAlvo: ymAdd(ym, 6), valorMensal: '', valorAcumulado: 400, status: 'ativa', obs: '' });
    add('provisions', { nome: 'Presentes de fim de ano', categoria: 'Presentes', valorAlvo: 1200, dataAlvo: `${ym.slice(0, 4)}-12`, valorMensal: '', valorAcumulado: 200, status: 'ativa', obs: '' });

    add('investments', { banco: 'XP', produto: 'CDB liquidez diária', tipo: 'Reserva de emergência', objetivo: 'Reserva de emergência', valorAtual: 28000, aporteMensalPlanejado: 500, liquidez: 'Diária', obs: '' });
    add('investments', { banco: 'Banco do Brasil', produto: 'Previdência', tipo: 'Previdência privada', objetivo: 'Aposentadoria', valorAtual: 15000, aporteMensalPlanejado: 300, liquidez: 'Baixa', obs: '' });

    save();
    toast('Dados de exemplo carregados. Explore o Dashboard!');
    rerender();
  }
}
