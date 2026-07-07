// Componentes de interface reutilizáveis: modal, formulário, tabela, badges.
import { h, fmt, fmtDate } from './utils.js';

// ---- Modal ----
export function modal(title, content, { wide = false } = {}) {
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: `modal ${wide ? 'modal-wide' : ''}` },
    h('div', { class: 'modal-head' },
      h('h3', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => overlay.remove() }, '✕')),
    h('div', { class: 'modal-body' }, content));
  overlay.append(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  return overlay;
}

// ---- Formulário genérico ----
// fields: [{k, label, type, options, value, required, placeholder, help, show(vals), onchange(vals, formEl)}]
// type: text | money | number | date | month | select | check | textarea
export function formModal(title, fields, values, onSave, { wide = false, saveLabel = 'Salvar' } = {}) {
  const vals = { ...values };
  const form = h('form', { class: 'form-grid' });

  function fieldInput(f) {
    const cur = vals[f.k] ?? f.value ?? (f.type === 'check' ? false : '');
    let input;
    if (f.type === 'select') {
      input = h('select', { name: f.k },
        f.required ? [] : h('option', { value: '' }, '—'),
        (f.options || []).map(o => {
          const [v, label] = Array.isArray(o) ? o : [o, o];
          return h('option', { value: v, selected: String(cur) === String(v) }, label);
        }));
    } else if (f.type === 'textarea') {
      input = h('textarea', { name: f.k, rows: 2, placeholder: f.placeholder || '' }, cur || '');
    } else if (f.type === 'check') {
      input = h('input', { type: 'checkbox', name: f.k });
      input.checked = !!cur;
    } else {
      const typeMap = { money: 'number', number: 'number', date: 'date', month: 'month', text: 'text' };
      input = h('input', {
        type: typeMap[f.type] || 'text', name: f.k, value: cur ?? '',
        step: f.type === 'money' ? '0.01' : (f.step || 'any'),
        placeholder: f.placeholder || '', required: !!f.required,
        min: f.min, max: f.max,
      });
    }
    // Selects exibem a primeira opção por padrão; refletir isso em vals.
    if (f.type === 'select' && (vals[f.k] === undefined || vals[f.k] === null)) vals[f.k] = input.value;
    input.addEventListener('input', () => {
      vals[f.k] = f.type === 'check' ? input.checked :
        (f.type === 'money' || f.type === 'number') ? (input.value === '' ? '' : Number(input.value)) : input.value;
      if (f.onchange) f.onchange(vals, form);
      refreshVisibility();
      syncValues(input);
    });
    row_inputs.set(f.k, input);
    return input;
  }

  // Reflete nos inputs os valores alterados por onchange (campos calculados).
  const row_inputs = new Map();
  function syncValues(except) {
    for (const [k, input] of row_inputs) {
      if (input === except || input.type === 'checkbox') continue;
      const v = vals[k];
      if (v !== undefined && v !== null && String(input.value) !== String(v)) input.value = v;
    }
  }

  const rows = fields.map(f => {
    const input = fieldInput(f);
    const row = f.type === 'check'
      ? h('label', { class: 'form-field form-check', 'data-k': f.k }, input, h('span', {}, f.label))
      : h('label', { class: `form-field ${f.full ? 'form-full' : ''}`, 'data-k': f.k },
          h('span', { class: 'form-label' }, f.label + (f.required ? ' *' : '')),
          input,
          f.help ? h('small', { class: 'form-help' }, f.help) : null);
    row._field = f;
    return row;
  });
  form.append(...rows);

  function refreshVisibility() {
    for (const row of rows) {
      const f = row._field;
      row.style.display = (f.show && !f.show(vals)) ? 'none' : '';
    }
  }
  // valores iniciais
  for (const f of fields) if (vals[f.k] === undefined && f.value !== undefined) vals[f.k] = f.value;
  refreshVisibility();

  const err = h('div', { class: 'form-error', style: 'display:none' });
  const overlay = modal(title, h('div', {}, form, err,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => overlay.remove() }, 'Cancelar'),
      h('button', {
        class: 'btn btn-primary', type: 'button', onclick: () => {
          for (const f of fields) {
            if (f.required && (f.show ? f.show(vals) : true)) {
              const v = vals[f.k];
              if (v === '' || v === undefined || v === null) {
                err.textContent = `Preencha o campo "${f.label}".`;
                err.style.display = 'block';
                return;
              }
            }
          }
          const res = onSave(vals);
          if (typeof res === 'string') { err.textContent = res; err.style.display = 'block'; return; }
          overlay.remove();
        },
      }, saveLabel))), { wide });
  return overlay;
}

export function confirmModal(msg, onYes, { yesLabel = 'Excluir', danger = true } = {}) {
  const overlay = modal('Confirmar', h('div', {},
    h('p', {}, msg),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-ghost', onclick: () => overlay.remove() }, 'Cancelar'),
      h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { onYes(); overlay.remove(); } }, yesLabel))));
}

// ---- Tabela ----
// cols: [{label, render(row) | k, money, right}]
export function table(cols, rows, { empty = 'Nenhum registro.' } = {}) {
  if (!rows.length) return h('div', { class: 'empty-state' }, empty);
  return h('div', { class: 'table-scroll' },
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.right || c.money ? 'right' : '' }, c.label)))),
      h('tbody', {}, rows.map(r => h('tr', {}, cols.map(c => {
        let content = c.render ? c.render(r) : r[c.k];
        if (c.money) content = fmt(content);
        if (c.date) content = fmtDate(content);
        return h('td', { class: c.right || c.money ? 'right' : '' }, content ?? '—');
      }))))));
}

// ---- Badges de status ----
const BADGE_STYLES = {
  pago: 'ok', recebida: 'ok', concluida: 'ok', ativa: 'ok',
  vencido: 'bad', atrasada: 'bad', atrasado: 'bad', contestado: 'bad',
  parcial: 'warn', solicitado: 'info',
  previsto: 'muted', prevista: 'muted', pendente: 'warn',
  cancelado: 'muted', cancelada: 'muted', pausada: 'muted', reembolsado: 'info',
};
const BADGE_LABELS = {
  pago: 'Pago', recebida: 'Recebida', previsto: 'Previsto', prevista: 'Prevista',
  vencido: 'Vencido', atrasada: 'Atrasada', atrasado: 'Atrasado', cancelado: 'Cancelado',
  cancelada: 'Cancelada', parcial: 'Parcial', pendente: 'Pendente', solicitado: 'Solicitado',
  contestado: 'Contestado', reembolsado: 'Reembolsado', ativa: 'Ativa', pausada: 'Pausada',
  concluida: 'Concluída',
};
export function badge(status) {
  return h('span', { class: `badge badge-${BADGE_STYLES[status] || 'muted'}` }, BADGE_LABELS[status] || status || '—');
}

// ---- Cards de resumo ----
export function statCard(label, value, { tone = '', sub = '', onclick } = {}) {
  const el = h('div', { class: `stat-card ${tone} ${onclick ? 'clickable' : ''}` },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, typeof value === 'number' ? fmt(value) : value),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
  if (onclick) el.addEventListener('click', onclick);
  return el;
}

export function card(title, ...children) {
  return h('section', { class: 'card' },
    title ? h('h2', { class: 'card-title' }, title) : null, ...children);
}

export function alertBanner(alerts) {
  if (!alerts.length) return null;
  return h('div', { class: 'alerts' }, alerts.map(a =>
    h('div', { class: `alert alert-${a.level}` },
      h('span', { class: 'alert-icon' }, a.level === 'erro' ? '⚠️' : a.level === 'aviso' ? '🔔' : 'ℹ️'),
      a.msg)));
}

// ---- Toast ----
export function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// Botões de ação em linha de tabela
export function rowActions(...btns) {
  return h('div', { class: 'row-actions' }, btns.map(([label, fn, title]) =>
    h('button', { class: 'icon-btn', title: title || label, onclick: fn }, label)));
}
