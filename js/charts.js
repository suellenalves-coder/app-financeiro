// Gráficos SVG leves: rosca, barras, barra empilhada horizontal e linhas.
// Paleta categórica validada (derivada dos pastéis da identidade, com contraste adequado).
import { h, fmt } from './utils.js';

export const CHART_COLORS = ['#2E9E63', '#7A63B8', '#C06A7C', '#3D8FC4', '#B8862F'];
export const CHART_MUTED = '#9AA1A9';
const INK = '#2F3437';
const INK2 = '#6B7280';
const GRID = '#E4E1D8';
const SURFACE = '#FFFFFF';

// Tooltip único compartilhado.
let tipEl = null;
function tooltip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'chart-tip', style: 'display:none' });
    document.body.append(tipEl);
  }
  return tipEl;
}
export function showTip(evt, html) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const x = Math.min(evt.clientX + 12, window.innerWidth - t.offsetWidth - 12);
  t.style.left = `${x}px`;
  t.style.top = `${evt.clientY + 14}px`;
}
export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

function svg(w, hh, cls = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  el.setAttribute('width', w);
  el.setAttribute('height', hh);
  el.setAttribute('class', `chart ${cls}`);
  el.setAttribute('role', 'img');
  return el;
}
function s(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function legend(items) {
  return h('div', { class: 'chart-legend' },
    items.map(([label, color]) => h('span', { class: 'legend-item' },
      h('span', { class: 'legend-dot', style: `background:${color}` }), label)));
}

// ---- Rosca (despesas por categoria). data: [[label, valor], ...] ----
export function donut(data, { size = 180, maxSlices = 5 } = {}) {
  let items = data.filter(([, v]) => v > 0);
  if (!items.length) return h('div', { class: 'chart-empty' }, 'Sem dados para exibir.');
  if (items.length > maxSlices) {
    const top = items.slice(0, maxSlices);
    top.push(['Outros', items.slice(maxSlices).reduce((a, [, v]) => a + v, 0)]);
    items = top;
  }
  const total = items.reduce((a, [, v]) => a + v, 0);
  const thick = 26;
  // O raio precisa deixar a espessura do traço inteira dentro do viewBox (r + thick/2 <= size/2),
  // senão a rosca é cortada pela própria borda do SVG — não é um problema de CSS do card.
  const r = size / 2 - thick / 2 - 3, cx = size / 2, cy = size / 2;
  const el = svg(size, size, 'donut');
  const colored = items.map(([label, v], i) => [label, v, label === 'Outros' ? CHART_MUTED : CHART_COLORS[i % CHART_COLORS.length]]);
  if (colored.length === 1) {
    // Categoria única (100%): anel fechado, sem espaçador — não há fatia vizinha para separar.
    const [label, v, color] = colored[0];
    const ring = s('circle', { cx, cy, r, fill: 'none', stroke: color, 'stroke-width': thick });
    ring.addEventListener('mousemove', e => showTip(e, `<b>${label}</b><br>${fmt(v)} · 100%`));
    ring.addEventListener('mouseleave', hideTip);
    el.append(ring);
  } else {
    let angle = -Math.PI / 2;
    for (const [label, v, color] of colored) {
      const frac = v / total;
      const a2 = angle + frac * Math.PI * 2 - 0.03; // 0.03 rad ≈ espaçador de 2px
      const large = frac > 0.5 ? 1 : 0;
      const p1 = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
      const p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
      const path = s('path', {
        d: `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${large} 1 ${p2[0]} ${p2[1]}`,
        fill: 'none', stroke: color, 'stroke-width': thick, 'stroke-linecap': 'butt',
      });
      path.addEventListener('mousemove', e => showTip(e, `<b>${label}</b><br>${fmt(v)} · ${(frac * 100).toFixed(0)}%`));
      path.addEventListener('mouseleave', hideTip);
      el.append(path);
      angle = a2 + 0.03;
    }
  }
  const center = s('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', fill: INK, 'font-size': 15, 'font-weight': 600 });
  center.textContent = fmt(total);
  const sub = s('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', fill: INK2, 'font-size': 11 });
  sub.textContent = 'total';
  el.append(center, sub);
  return h('div', { class: 'chart-wrap' }, el, legend(colored.map(([l, , c]) => [l, c])));
}

// ---- Barra empilhada horizontal (comprometimento da renda) ----
// segments: [[label, valor, cor], ...]; total = soma (ou receita segura).
export function hstack(segments, total) {
  const width = 600, height = 44, barH = 22;
  const el = svg(width, height, 'hstack');
  const tot = Math.max(total, segments.reduce((a, [, v]) => a + v, 0)) || 1;
  let x = 0;
  for (const [label, v, color] of segments) {
    if (v <= 0) continue;
    const w = Math.max(0, (v / tot) * width - 2);
    const rect = s('rect', { x, y: 10, width: w, height: barH, rx: 4, fill: color });
    rect.addEventListener('mousemove', e => showTip(e, `<b>${label}</b><br>${fmt(v)} · ${(v / tot * 100).toFixed(0)}%`));
    rect.addEventListener('mouseleave', hideTip);
    el.append(rect);
    x += w + 2;
  }
  return h('div', { class: 'chart-wrap' }, el,
    legend(segments.filter(([, v]) => v > 0).map(([l, , c]) => [l, c])));
}

// ---- Barras verticais. labels: [..], series: [{name, color, values:[..]}] ----
export function bars(labels, series, { height = 220, money = true } = {}) {
  const width = 640, padL = 56, padB = 26, padT = 12;
  const el = svg(width, height, 'bars');
  const all = series.flatMap(sr => sr.values);
  const max = Math.max(...all, 0) || 1;
  const min = Math.min(...all, 0);
  const range = max - min || 1;
  const y = v => padT + (max - v) / range * (height - padT - padB);
  const zero = y(0);
  // grade
  for (let i = 0; i <= 3; i++) {
    const v = min + range * i / 3;
    const yy = y(v);
    el.append(s('line', { x1: padL, y1: yy, x2: width - 8, y2: yy, stroke: GRID, 'stroke-width': 1 }));
    const t = s('text', { x: padL - 6, y: yy + 4, 'text-anchor': 'end', fill: INK2, 'font-size': 10 });
    t.textContent = money ? compact(v) : Math.round(v);
    el.append(t);
  }
  const groupW = (width - padL - 16) / labels.length;
  const barW = Math.min(26, (groupW - 6) / series.length - 2);
  labels.forEach((label, li) => {
    const gx = padL + li * groupW + groupW / 2 - (series.length * (barW + 2)) / 2;
    series.forEach((sr, si) => {
      const v = sr.values[li] || 0;
      const yy = y(Math.max(0, v)), hh = Math.abs(y(v) - zero);
      const rect = s('rect', {
        x: gx + si * (barW + 2), y: v >= 0 ? yy : zero, width: barW, height: Math.max(1, hh),
        rx: 3, fill: v >= 0 ? sr.color : '#E57373',
      });
      rect.addEventListener('mousemove', e => showTip(e, `<b>${label}</b><br>${sr.name}: ${money ? fmt(v) : v}`));
      rect.addEventListener('mouseleave', hideTip);
      el.append(rect);
    });
    const t = s('text', { x: padL + li * groupW + groupW / 2, y: height - 8, 'text-anchor': 'middle', fill: INK2, 'font-size': 10 });
    t.textContent = label;
    el.append(t);
  });
  el.append(s('line', { x1: padL, y1: zero, x2: width - 8, y2: zero, stroke: INK2, 'stroke-width': 1 }));
  const wrap = h('div', { class: 'chart-wrap chart-scroll' }, el);
  if (series.length > 1) wrap.append(legend(series.map(sr => [sr.name, sr.color])));
  return wrap;
}

// ---- Linhas. labels: [..], series: [{name, color, values:[..]}] ----
export function lines(labels, series, { height = 220 } = {}) {
  const width = 640, padL = 56, padB = 26, padT = 12;
  const el = svg(width, height, 'lines');
  const all = series.flatMap(sr => sr.values);
  const max = Math.max(...all, 0) || 1;
  const min = Math.min(...all, 0);
  const range = max - min || 1;
  const y = v => padT + (max - v) / range * (height - padT - padB);
  const x = i => padL + i * (width - padL - 16) / Math.max(1, labels.length - 1);
  for (let i = 0; i <= 3; i++) {
    const v = min + range * i / 3;
    el.append(s('line', { x1: padL, y1: y(v), x2: width - 8, y2: y(v), stroke: GRID, 'stroke-width': 1 }));
    const t = s('text', { x: padL - 6, y: y(v) + 4, 'text-anchor': 'end', fill: INK2, 'font-size': 10 });
    t.textContent = compact(v);
    el.append(t);
  }
  if (min < 0) el.append(s('line', { x1: padL, y1: y(0), x2: width - 8, y2: y(0), stroke: INK2, 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  labels.forEach((label, i) => {
    if (labels.length > 8 && i % 2 !== 0) return;
    const t = s('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', fill: INK2, 'font-size': 10 });
    t.textContent = label;
    el.append(t);
  });
  for (const sr of series) {
    const d = sr.values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
    el.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    sr.values.forEach((v, i) => {
      const dot = s('circle', { cx: x(i), cy: y(v), r: 4, fill: sr.color, stroke: SURFACE, 'stroke-width': 2 });
      dot.addEventListener('mousemove', e => showTip(e, `<b>${labels[i]}</b><br>${sr.name}: ${fmt(v)}`));
      dot.addEventListener('mouseleave', hideTip);
      el.append(dot);
    });
  }
  const wrap = h('div', { class: 'chart-wrap chart-scroll' }, el);
  if (series.length > 1) wrap.append(legend(series.map(sr => [sr.name, sr.color])));
  return wrap;
}

function compact(v) {
  const abs = Math.abs(v);
  if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return String(Math.round(v));
}
