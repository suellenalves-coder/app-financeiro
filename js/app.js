// Shell do app: navegação, seletor de mês, onboarding e roteamento.
import { h, ymLabel, ymAdd } from './utils.js';
import { db, ui, save } from './store.js';
import { formModal, modal, toast } from './ui.js';
import * as sync from './sync.js';

import * as dashboard from './views/dashboard.js';
import * as anual from './views/anual.js';
import * as receitas from './views/receitas.js';
import * as despesas from './views/despesas.js';
import * as cartoes from './views/cartoes.js';
import * as recorrentes from './views/recorrentes.js';
import * as provisoes from './views/provisoes.js';
import * as investimentos from './views/investimentos.js';
import * as reembolsos from './views/reembolsos.js';
import * as calendario from './views/calendario.js';
import * as fechamento from './views/fechamento.js';
import * as simulador from './views/simulador.js';
import * as relatorios from './views/relatorios.js';
import * as carro from './views/carro.js';
import * as config from './views/config.js';

const ROUTES = [
  { path: 'dashboard', label: 'Dashboard', icon: '🏠', view: dashboard, month: true },
  { path: 'anual', label: 'Visão anual', icon: '📅', view: anual },
  { path: 'calendario', label: 'Calendário', icon: '🗓️', view: calendario, month: true },
  { path: 'receitas', label: 'Receitas', icon: '💰', view: receitas, month: true },
  { path: 'despesas', label: 'Despesas', icon: '🧾', view: despesas, month: true },
  { path: 'cartoes', label: 'Cartões e parcelas', icon: '💳', view: cartoes, month: true },
  { path: 'recorrentes', label: 'Contas recorrentes', icon: '🔁', view: recorrentes, month: true },
  { path: 'provisoes', label: 'Provisões', icon: '🏦', view: provisoes, month: true },
  { path: 'investimentos', label: 'Investimentos', icon: '📈', view: investimentos, month: true },
  { path: 'reembolsos', label: 'Reembolsos', icon: '🤝', view: reembolsos },
  { path: 'simulador', label: 'Simulador de compra', icon: '🧮', view: simulador },
  { path: 'carro', label: 'Carro', icon: '🚗', view: carro, month: true },
  { path: 'fechamento', label: 'Fechamento mensal', icon: '✅', view: fechamento, month: true },
  { path: 'relatorios', label: 'Relatórios', icon: '📊', view: relatorios },
  { path: 'config', label: 'Configurações', icon: '⚙️', view: config },
];

const MOBILE_NAV = ['dashboard', 'calendario', 'despesas', 'cartoes', 'reembolsos', 'investimentos', 'provisoes', 'relatorios', 'config'];

function currentRoute() {
  const path = (location.hash || '#/dashboard').replace(/^#\//, '').split('?')[0];
  return ROUTES.find(r => r.path === path) || ROUTES[0];
}

export function render() {
  const route = currentRoute();
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Sidebar (desktop)
  const sidebar = h('nav', { class: 'sidebar' },
    h('div', { class: 'logo' }, '🌿 Meu Orçamento', h('small', {}, 'Inteligente')),
    ROUTES.map(r => h('a', {
      class: `nav-link ${r.path === route.path ? 'active' : ''}`, href: `#/${r.path}`,
    }, h('span', { class: 'nav-icon' }, r.icon), r.label)));

  // Menu inferior (mobile)
  const bottomNav = h('nav', { class: 'bottom-nav' },
    MOBILE_NAV.map(p => {
      const r = ROUTES.find(x => x.path === p);
      return h('a', { class: r.path === route.path ? 'active' : '', href: `#/${r.path}` },
        h('span', { class: 'nav-icon' }, r.icon), r.label.split(' ')[0]);
    }));

  // Barra superior com seletor de mês
  const topbar = h('div', { class: 'topbar' },
    h('h1', {}, route.icon + ' ' + route.label),
    route.month !== false && route.month ? monthPicker() : null);

  const content = h('div', {});
  const main = h('main', { class: 'main' }, topbar, content);

  app.append(sidebar, main, bottomNav,
    h('button', { class: 'fab', title: 'Nova despesa', onclick: () => despesas.quickAdd(render) }, '+'));

  route.view.render(content, render);

  if (!db.settings.onboardingDone && !document.querySelector('.modal-overlay')) showOnboarding();
}

function monthPicker() {
  return h('div', { class: 'month-picker' },
    h('button', { onclick: () => { ui.month = ymAdd(ui.month, -1); render(); } }, '‹'),
    h('span', { class: 'month-label' }, ymLabel(ui.month)),
    h('button', { onclick: () => { ui.month = ymAdd(ui.month, 1); render(); } }, '›'));
}

function showOnboarding() {
  const steps = [
    ['Informe sua renda segura mensal e suas metas', null],
    ['Cadastre seus bancos e cartões', '#/config'],
    ['Cadastre suas contas recorrentes (aluguel, luz, assinaturas…)', '#/recorrentes'],
    ['Importe seus parcelamentos existentes em massa', '#/cartoes'],
    ['Cadastre as pessoas que devem reembolsos a você', '#/config'],
    ['Acompanhe tudo pelo Dashboard', '#/dashboard'],
  ];
  const overlay = formModal('Bem-vinda ao Meu Orçamento Inteligente 🌿', [
    { k: 'nome', label: 'Como podemos te chamar?', type: 'text', placeholder: 'Seu nome' },
    { k: 'rendaSegura', label: 'Renda segura mensal (R$)', type: 'money', required: true, help: 'Salário e rendas garantidas. Você poderá detalhar depois em Receitas.' },
    { k: 'metaReservaMin', label: 'Meta mínima de reserva (R$)', type: 'money', value: db.settings.metaReservaMin },
    { k: 'aporteMinimoMensal', label: 'Aporte mensal desejado (R$)', type: 'money' },
  ], { ...db.settings }, vals => {
    Object.assign(db.settings, vals, { onboardingDone: true });
    // Cria a receita segura recorrente inicial
    if (vals.rendaSegura > 0 && !db.incomes.length) {
      db.incomes.push({
        id: 'renda-inicial', data: `${ui.month}-05`, descricao: 'Salário',
        categoria: 'Salário fixo', valor: vals.rendaSegura, tipo: 'segura',
        status: 'prevista', recorrente: true, obs: 'Criada no primeiro acesso',
      });
    }
    save();
    modal('Próximos passos', h('div', {},
      steps.map(([txt, href], i) => h('div', { class: 'onboard-step' },
        h('span', { class: 'onboard-num' }, i + 1),
        href ? h('a', { href, onclick: () => document.querySelector('.modal-overlay')?.remove() }, txt) : h('span', {}, txt)))));
    render();
  }, { saveLabel: 'Começar' });
  // onboarding não pode ser fechado clicando fora sem preencher — mas permitimos fechar e usar depois
  overlay.querySelector('.icon-btn').addEventListener('click', () => {
    db.settings.onboardingDone = true; save();
  });
}

window.addEventListener('hashchange', render);
sync.init(() => { toast('Dados atualizados a partir da nuvem.'); render(); });
render();
