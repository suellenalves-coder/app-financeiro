// Persistência em localStorage e catálogo de valores padrão.
import { uid, ymNow } from './utils.js';

const KEY = 'meu-orcamento-inteligente:v1';

export const CATEGORIAS_DESPESA = [
  'Moradia', 'Condomínio', 'Luz', 'Gás', 'Internet, TV e celular', 'Mercado',
  'Alimentação fora de casa', 'Transporte', 'Combustível', 'Carro', 'Pedágio/Estacionamento', 'Saúde',
  'Educação', 'Lazer', 'Viagem', 'Casa', 'Presentes', 'Beleza e cuidados pessoais',
  'Assinaturas', 'Tarifas e juros', 'Impostos', 'Dívidas', 'Outros',
];

export const CATEGORIAS_RECEITA = [
  'Salário fixo', 'Renda variável', 'Aula ou docência', 'Projeto pontual',
  'Reembolso', 'Restituição', 'Rendimento de investimento', 'Movimentação patrimonial', 'Outros',
];

export const TIPOS_RECEITA = [
  ['segura', 'Receita segura'], ['variavel', 'Receita variável'],
  ['extraordinaria', 'Receita extraordinária'], ['reembolso', 'Reembolso'],
  ['resgate_investimento', 'Resgate de Investimento'],
];

export const STATUS_RECEITA = [
  ['prevista', 'Prevista'], ['recebida', 'Recebida'], ['atrasada', 'Atrasada'], ['cancelada', 'Cancelada'],
];

export const CLASSIFICACAO_DESPESA = [
  'Essencial', 'Compromisso financeiro', 'Construção de futuro',
  'Qualidade de vida', 'Vazamento', 'Reembolsável', 'Extraordinária',
];

export const STATUS_DESPESA = [
  ['previsto', 'Previsto'], ['pago', 'Pago'], ['vencido', 'Vencido'],
  ['cancelado', 'Cancelado'], ['parcial', 'Parcialmente pago'], ['reembolsado', 'Reembolsado'],
];

export const STATUS_REEMBOLSO = [
  ['pendente', 'Pendente'], ['solicitado', 'Solicitado'], ['parcial', 'Parcialmente pago'],
  ['pago', 'Pago'], ['cancelado', 'Cancelado'], ['contestado', 'Contestado'], ['atrasado', 'Atrasado'],
];

export const FORMAS_PAGAMENTO = ['Pix', 'Débito', 'Cartão de crédito', 'Boleto', 'Dinheiro', 'Transferência', 'Débito automático'];

export const PERIODICIDADES = [
  ['mensal', 'Mensal', 1], ['bimestral', 'Bimestral', 2], ['trimestral', 'Trimestral', 3],
  ['semestral', 'Semestral', 6], ['anual', 'Anual', 12],
];

export const TIPOS_INVESTIMENTO = [
  'Reserva de emergência', 'CDB', 'Previdência privada', 'Fundo multimercado',
  'FII', 'Tesouro Direto', 'Ações', 'Outros',
];

export const OBJETIVOS_INVESTIMENTO = [
  'Reserva de emergência', 'Aposentadoria', 'Renda passiva',
  'Objetivo de curto prazo', 'Objetivo de médio prazo', 'Objetivo de longo prazo',
];

export const CRITERIOS_DIVISAO = [
  ['fixo', 'Valor fixo'], ['percentual', 'Percentual'], ['igual', 'Divisão igual'],
  ['integral', 'Reembolso integral'], ['personalizado', 'Personalizado'],
];

export const CATEGORIAS_CARRO = ['Carro', 'Combustível', 'Pedágio/Estacionamento'];

// Metadados de navegação (path/label/ícone) usados tanto pelo menu (app.js) quanto pela
// tela de Configurações → Navegação — mantidos aqui (não em app.js) pra evitar import
// circular entre os dois.
export const NAV_SECTIONS = [
  ['dashboard', 'Dashboard', '🏠'],
  ['anual', 'Visão anual', '📅'],
  ['calendario', 'Calendário', '🗓️'],
  ['receitas', 'Receitas', '💰'],
  ['despesas', 'Despesas', '🧾'],
  ['contas', 'Contas bancárias', '🏛️'],
  ['cartoes', 'Cartões e parcelas', '💳'],
  ['mapa-parcelamentos', 'Mapa de parcelamentos', '🗺️'],
  ['recorrentes', 'Contas recorrentes', '🔁'],
  ['provisoes', 'Provisões', '🏦'],
  ['investimentos', 'Investimentos', '📈'],
  ['reembolsos', 'Reembolsos', '🤝'],
  ['simulador', 'Simulador de compra', '🧮'],
  ['carro', 'Carro', '🚗'],
  ['fechamento', 'Fechamento mensal', '✅'],
  ['relatorios', 'Relatórios', '📊'],
  ['config', 'Configurações', '⚙️'],
];

function defaults() {
  return {
    version: 1,
    settings: {
      nome: '',
      rendaSegura: 0,
      metaReservaMin: 35000,
      metaReservaMax: 40000,
      limiteComprometimento: 70,
      aporteMinimoMensal: 0,
      limiteLazer: 0,
      limiteAlimentacaoFora: 0,
      saldoMinimoSeguranca: 0,
      limiteParcelamentosPct: 30, // % da renda segura que os parcelamentos podem ocupar
      // Navegação simplificada: rotas escondidas do menu (mas o código e os dados
      // continuam intactos — reative a qualquer momento em Configurações → Navegação).
      // Dashboard e Configurações nunca entram aqui, pra nunca ficar sem acesso a elas.
      hiddenSections: ['mapa-parcelamentos', 'provisoes', 'simulador', 'carro', 'fechamento', 'relatorios', 'calendario'],
      onboardingDone: false,
      carroCategoriasAtivas: [...CATEGORIAS_CARRO], // quais categorias entram na análise do módulo Carro
    },
    banks: ['XP', 'Santander', 'Banco do Brasil', 'C6'].map(nome => ({ id: uid(), nome })),
    categoriesExpense: CATEGORIAS_DESPESA.map(nome => ({ id: uid(), nome, sub: [] })),
    categoriesIncome: CATEGORIAS_RECEITA.map(nome => ({ id: uid(), nome })),
    categoryBudgets: [], // limites mensais por categoria de despesa: { id, categoria, limiteMensal }
    people: [],
    accounts: [], // contas bancárias: { id, banco, apelido, saldoInicial, ativo }
    accountAdjustments: [], // conciliações manuais de saldo: { id, contaId, data, valor (delta com sinal), obs }
    cards: [],
    incomes: [],
    expenses: [],
    purchases: [],
    installments: [],
    recurring: [],
    recurringOcc: {},   // "recId:YYYY-MM" -> { status, valor, dataPagamento }
    provisions: [],
    provisionDeposits: [], // { id, provisaoId, mes, valor }
    investments: [],
    investContrib: [],  // { id, investimentoId, data, valor }
    investRedemptions: [], // resgates: { id, investimentoId, data, valor, saldoAnterior, saldoAtualizado, bancoOrigem, produtoOrigem, contaDestino, obs, incomeId }
    reimbursements: [],
    refuelings: [], // abastecimentos: { id, data, kmRegistrado, precoLitro, litros, valorTotal, formaPagamento, cartaoId, banco, expenseId, obs }
    rules: [
      { id: uid(), contem: 'posto', acao: 'categoria', valor: 'Combustível' },
      { id: uid(), contem: 'ifood', acao: 'categoria', valor: 'Alimentação fora de casa' },
      { id: uid(), contem: 'uber', acao: 'categoria', valor: 'Transporte' },
      { id: uid(), contem: 'farmácia', acao: 'categoria', valor: 'Saúde' },
    ],
    _deleted: {}, // id → timestamp da exclusão (para a mesclagem entre aparelhos não ressuscitar itens)
  };
}

export let db = load();

// Garante que categorias adicionadas em versões novas do app existam mesmo em bases
// salvas antes delas (o merge de load()/replaceDb() substitui a lista inteira).
function ensureDefaultCategories(data) {
  if (!data.categoriesIncome.some(c => c.nome === 'Movimentação patrimonial')) {
    data.categoriesIncome.push({ id: uid(), nome: 'Movimentação patrimonial' });
  }
  if (!data.categoriesExpense.some(c => c.nome === 'Pedágio/Estacionamento')) {
    data.categoriesExpense.push({ id: uid(), nome: 'Pedágio/Estacionamento', sub: [] });
  }
}

// Corrige registros sem id que possam ter sido salvos por um bug já corrigido em
// add() (ex.: receitas recorrentes materializadas, despesas duplicadas) — um item
// sem id é descartado silenciosamente na mesclagem entre aparelhos.
function ensureItemIds(data) {
  for (const key of Object.keys(data)) {
    if (!Array.isArray(data[key])) continue;
    for (const item of data[key]) {
      if (item && typeof item === 'object' && !item.id) item.id = uid();
    }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const merged = Object.assign(defaults(), data, { settings: Object.assign(defaults().settings, data.settings) });
      ensureDefaultCategories(merged);
      ensureItemIds(merged);
      return merged;
    }
  } catch (e) { console.error('Falha ao carregar dados', e); }
  return defaults();
}

// Gancho chamado após cada save (usado pela sincronização na nuvem).
let onSaveHook = null;
export function setOnSave(fn) { onSaveHook = fn; }

export function save() {
  db._modified = Date.now();
  localStorage.setItem(KEY, JSON.stringify(db));
  if (onSaveHook) onSaveHook();
}

// Substitui todos os dados locais (ao baixar da nuvem), sem disparar novo envio.
// Muta o objeto db existente para manter as referências dos demais módulos.
export function replaceDb(data) {
  const novo = Object.assign(defaults(), data, { settings: Object.assign(defaults().settings, data.settings) });
  ensureDefaultCategories(novo);
  ensureItemIds(novo);
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, novo);
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function resetAll() {
  replaceDb(defaults());
  save();
}

// CRUD genérico por coleção. _ts marca a última alteração de cada item,
// usado na mesclagem entre aparelhos (o mais recente vence, item a item).
// id e _ts vêm DEPOIS do ...obj de propósito: um chamador que espalhe um objeto
// com `id: undefined` (ex.: ao duplicar/materializar um registro) não pode apagar
// o id novo — um item sem id é descartado silenciosamente na mesclagem entre
// aparelhos (ver mergeById em sync.js), então isso já causou perda de dados real.
export function add(coll, obj) {
  const item = { ...obj, id: uid(), _ts: Date.now() };
  db[coll].push(item);
  save();
  return item;
}

export function update(coll, id, patch) {
  const item = db[coll].find(x => x.id === id);
  if (item) { Object.assign(item, patch, { _ts: Date.now() }); save(); }
  return item;
}

export function remove(coll, id) {
  db._deleted[id] = Date.now();
  db[coll] = db[coll].filter(x => x.id !== id);
  save();
}

// Exclusão em lote com registro de tombstones (usar no lugar de db[coll] = db[coll].filter(...)).
export function removeWhere(coll, pred) {
  for (const item of db[coll]) if (pred(item)) db._deleted[item.id] = Date.now();
  db[coll] = db[coll].filter(x => !pred(x));
  save();
}

export function get(coll, id) {
  return db[coll].find(x => x.id === id);
}

// Rotas que nunca podem ficar escondidas do menu — sem elas não daria pra navegar de
// volta nem reativar uma seção escondida.
export const SEMPRE_VISIVEIS = ['dashboard', 'config'];
export function isSectionVisible(path) {
  return SEMPRE_VISIVEIS.includes(path) || !db.settings.hiddenSections.includes(path);
}

// Estado de interface (mês selecionado), fora dos dados persistidos principais.
export const ui = {
  month: ymNow(),
  year: Number(ymNow().slice(0, 4)),
};

// Regras automáticas de categorização
export function applyRules(descricao) {
  const out = {};
  const desc = (descricao || '').toLowerCase();
  for (const r of db.rules) {
    if (r.contem && desc.includes(r.contem.toLowerCase())) {
      if (r.acao === 'categoria') out.categoria = r.valor;
      if (r.acao === 'pessoa') out.pessoaNome = r.valor;
    }
  }
  return out;
}
