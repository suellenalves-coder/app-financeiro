// Persistência em localStorage e catálogo de valores padrão.
import { uid, ymNow } from './utils.js';

const KEY = 'meu-orcamento-inteligente:v1';

export const CATEGORIAS_DESPESA = [
  'Moradia', 'Condomínio', 'Luz', 'Gás', 'Internet, TV e celular', 'Mercado',
  'Alimentação fora de casa', 'Transporte', 'Combustível', 'Carro', 'Saúde',
  'Educação', 'Lazer', 'Viagem', 'Casa', 'Presentes', 'Beleza e cuidados pessoais',
  'Assinaturas', 'Tarifas e juros', 'Impostos', 'Dívidas', 'Outros',
];

export const CATEGORIAS_RECEITA = [
  'Salário fixo', 'Renda variável', 'Aula ou docência', 'Projeto pontual',
  'Reembolso', 'Restituição', 'Rendimento de investimento', 'Outros',
];

export const TIPOS_RECEITA = [
  ['segura', 'Receita segura'], ['variavel', 'Receita variável'],
  ['extraordinaria', 'Receita extraordinária'], ['reembolso', 'Reembolso'],
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

export const CATEGORIAS_CARRO = ['Carro', 'Combustível', 'Transporte'];

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
      onboardingDone: false,
    },
    banks: ['XP', 'Santander', 'Banco do Brasil', 'C6'].map(nome => ({ id: uid(), nome })),
    categoriesExpense: CATEGORIAS_DESPESA.map(nome => ({ id: uid(), nome, sub: [] })),
    categoriesIncome: CATEGORIAS_RECEITA.map(nome => ({ id: uid(), nome })),
    people: [],
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
    reimbursements: [],
    rules: [
      { id: uid(), contem: 'posto', acao: 'categoria', valor: 'Combustível' },
      { id: uid(), contem: 'ifood', acao: 'categoria', valor: 'Alimentação fora de casa' },
      { id: uid(), contem: 'uber', acao: 'categoria', valor: 'Transporte' },
      { id: uid(), contem: 'farmácia', acao: 'categoria', valor: 'Saúde' },
    ],
  };
}

export let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return Object.assign(defaults(), data, { settings: Object.assign(defaults().settings, data.settings) });
    }
  } catch (e) { console.error('Falha ao carregar dados', e); }
  return defaults();
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function resetAll() {
  db = defaults();
  save();
}

// CRUD genérico por coleção
export function add(coll, obj) {
  const item = { id: uid(), ...obj };
  db[coll].push(item);
  save();
  return item;
}

export function update(coll, id, patch) {
  const item = db[coll].find(x => x.id === id);
  if (item) { Object.assign(item, patch); save(); }
  return item;
}

export function remove(coll, id) {
  db[coll] = db[coll].filter(x => x.id !== id);
  save();
}

export function get(coll, id) {
  return db[coll].find(x => x.id === id);
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
