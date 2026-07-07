// Utilitários gerais: formatação, datas, DOM.

export const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmt(v) {
  return BRL.format(Number(v) || 0);
}

export function fmtPct(v) {
  return `${(Number(v) || 0).toFixed(0)}%`;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

// ---- Meses no formato 'YYYY-MM' ----
export function ymNow() {
  return todayISO().slice(0, 7);
}

export function ymOf(dateStr) {
  return (dateStr || '').slice(0, 7);
}

export function ymAdd(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function ymDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (ya * 12 + ma) - (yb * 12 + mb);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function ymLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

export function ymShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES_CURTO[m - 1]}/${String(y).slice(2)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Data 'YYYY-MM-DD' dentro do mês ym, respeitando meses curtos (dia 31 → 30/28).
export function dateInMonth(ym, day) {
  return `${ym}-${pad(Math.min(day || 1, daysInMonth(ym)))}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

// ---- DOM ----
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- CSV ----
export function toCSV(rows, headers) {
  const escape = v => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(';')];
  for (const r of rows) lines.push(headers.map(hd => escape(r[hd])).join(';'));
  return lines.join('\n');
}

export function downloadFile(name, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Aceita ; , ou tab como separador; primeira linha = cabeçalho.
export function parseTable(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
  const split = line => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = split(lines[0]).map(s => s.toLowerCase());
  const rows = lines.slice(1).map(l => {
    const cells = split(l);
    const obj = {};
    headers.forEach((hd, i) => { obj[hd] = cells[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

// Converte "1.234,56", "R$ 200" ou "200.5" em número.
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  let t = String(s || '').replace(/[R$\s]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  return parseFloat(t) || 0;
}

// Converte "08/2026", "ago/2026" ou "2026-08" em 'YYYY-MM'.
export function parseYm(s) {
  const t = String(s || '').trim().toLowerCase();
  if (/^\d{4}-\d{2}/.test(t)) return t.slice(0, 7);
  let m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${pad(+m[1])}`;
  m = t.match(/^([a-zç]{3})[a-zç]*[\/\-\s](\d{2,4})$/);
  if (m) {
    const idx = MESES_CURTO.indexOf(m[1].slice(0, 3));
    if (idx >= 0) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${pad(idx + 1)}`;
  }
  return '';
}

export function sum(arr, fn = x => x) {
  return arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
}
