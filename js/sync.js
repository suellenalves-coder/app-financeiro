// Sincronização na nuvem via Supabase (auth + tabela "orcamentos").
// Estratégia: o documento inteiro (db) é salvo em uma linha por usuária, em jsonb.
// Conflitos são resolvidos por "última gravação vence" (timestamp _modified).
// A configuração (URL, chave, sessão) fica FORA dos dados sincronizados.
import { db, save, replaceDb, setOnSave } from './store.js';

const CFG_KEY = 'meu-orcamento-inteligente:supabase';

export const state = {
  status: 'off',       // off | configurado | conectado | sincronizando | erro
  error: '',
  lastSync: null,
};

let cfg = loadCfg();

function loadCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

export function getConfig() { return { url: cfg.url || '', anonKey: cfg.anonKey || '' }; }
export function isConfigured() { return !!(cfg.url && cfg.anonKey); }
export function isLoggedIn() { return !!(cfg.session && cfg.session.refresh_token); }
export function userEmail() { return cfg.session?.user?.email || ''; }

// Aceita a URL completa ou apenas o ID do projeto (ex.: "fsclryvylknuooayreet").
export function normalizeUrl(input) {
  const t = String(input || '').trim().replace(/\/+$/, '');
  if (/^[a-z0-9]{15,}$/i.test(t)) return `https://${t.toLowerCase()}.supabase.co`;
  if (/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|red)$/i.test(t)) return t;
  return '';
}

export function setConfig(url, anonKey) {
  cfg.url = normalizeUrl(url) || url.replace(/\/+$/, '');
  cfg.anonKey = anonKey.trim();
  saveCfg();
  state.status = 'configurado';
}

// ---- Link para conectar outro aparelho ----
// Gera um endereço que já leva a URL e a chave anon embutidas (nunca a sessão/senha).
// Codificação em base64 url-safe para caber no hash sem escapar caracteres.
export function buildConnectLink() {
  if (!isConfigured()) return '';
  const payload = b64encode(JSON.stringify({ u: cfg.url, k: cfg.anonKey }));
  const base = location.href.split('#')[0];
  return `${base}#/config?conectar=${payload}`;
}

// Extrai a configuração de um link de conexão colado (ou retorna null).
export function parseConnectInput(text) {
  const m = String(text || '').match(/conectar=([A-Za-z0-9_\-%]+)/);
  if (!m) return null;
  try {
    const { u, k } = JSON.parse(b64decode(decodeURIComponent(m[1])));
    if (u && k) return { url: u, anonKey: k };
  } catch { /* link inválido */ }
  return null;
}

// Lê o parâmetro "conectar" do hash e aplica a configuração. Retorna true se aplicou.
export function applyConnectFromHash() {
  const m = (location.hash || '').match(/[?&]conectar=([^&]+)/);
  if (!m) return false;
  try {
    const { u, k } = JSON.parse(b64decode(decodeURIComponent(m[1])));
    if (u && k) {
      setConfig(u, k);
      // Limpa o parâmetro da URL, preservando a rota.
      const rota = (location.hash.split('?')[0]) || '#/config';
      history.replaceState(null, '', location.pathname + location.search + rota);
      return true;
    }
  } catch { /* link inválido */ }
  return false;
}

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s)));
}

// Diagnóstico da configuração: roda no navegador da usuária e informa o que falta.
export async function testSetup(url = cfg.url, anonKey = cfg.anonKey) {
  const checks = [];
  const push = (ok, label, detail = '') => checks.push({ ok, label, detail });

  // 1. Projeto no ar + chave válida
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
    if (res.ok) push(true, 'Projeto encontrado e no ar', url);
    else if (res.status === 401 || res.status === 403) {
      push(true, 'Projeto encontrado e no ar', url);
      push(false, 'Chave anon inválida', 'Confira em Settings → API → anon public (é um texto longo começando com "eyJ").');
    } else push(false, 'Projeto respondeu com erro', `HTTP ${res.status}. O projeto pode estar pausado — abra o painel do Supabase para reativá-lo.`);
  } catch {
    push(false, 'Não foi possível alcançar o projeto', `Verifique o endereço: ${url || '(vazio)'}. Ele deve ter o formato https://SEU-ID.supabase.co`);
    return checks;
  }

  // 2. Tabela "orcamentos" criada (script supabase/schema.sql)
  try {
    const res = await fetch(`${url}/rest/v1/orcamentos?select=user_id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.ok) {
      push(true, 'Tabela "orcamentos" criada', 'O script schema.sql foi executado.');
      push(true, 'Segurança (RLS) ativa', 'Sem login, nenhum dado fica visível — como deve ser.');
    } else {
      const body = await res.json().catch(() => ({}));
      const msg = body.message || '';
      if (res.status === 404 || /schema cache|does not exist|relation/i.test(msg)) {
        push(false, 'Tabela "orcamentos" não existe', 'Abra o SQL Editor no Supabase, cole o conteúdo de supabase/schema.sql e clique em Run.');
      } else if (res.status === 401) {
        push(false, 'Chave anon inválida', 'Confira em Settings → API → anon public.');
      } else {
        push(false, 'Erro ao consultar a tabela', `${msg || `HTTP ${res.status}`}`);
      }
    }
  } catch (e) {
    push(false, 'Erro ao consultar a tabela', e.message);
  }

  // 3. Sessão
  if (isLoggedIn()) {
    try {
      await fetchRemote();
      push(true, `Login ativo (${userEmail()})`, 'Sincronização pronta para uso.');
    } catch (e) {
      push(false, 'Login com problema', e.message);
    }
  } else {
    push(false, 'Você ainda não entrou', 'Use "Criar conta" (primeira vez) ou "Entrar" com seu e-mail e senha.');
  }
  return checks;
}

export function disconnect() {
  cfg = {};
  saveCfg();
  state.status = 'off';
  state.error = '';
}

export function signOut() {
  delete cfg.session;
  saveCfg();
  state.status = isConfigured() ? 'configurado' : 'off';
}

// ---- HTTP ----
async function authFetch(path, options = {}) {
  await refreshIfNeeded();
  const headers = {
    apikey: cfg.anonKey,
    'Content-Type': 'application/json',
    ...(cfg.session?.access_token ? { Authorization: `Bearer ${cfg.session.access_token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${cfg.url}${path}`, { ...options, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.msg || j.message || j.error_description || j.error || msg; } catch { /* corpo vazio */ }
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function refreshIfNeeded() {
  const s = cfg.session;
  if (!s || !s.refresh_token) return;
  const expiresAt = (s.expires_at || 0) * 1000;
  if (expiresAt - Date.now() > 60000) return;
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { signOut(); throw new Error('Sessão expirou. Entre novamente.'); }
  setSession(await res.json());
}

function setSession(data) {
  cfg.session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user?.id, email: data.user?.email },
  };
  saveCfg();
}

// ---- Autenticação ----
export async function signUp(email, password) {
  const data = await authFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data?.access_token) {
    setSession(data);
    state.status = 'conectado';
    return { ok: true };
  }
  return { ok: true, confirm: true }; // projeto exige confirmação por e-mail
}

export async function signIn(email, password) {
  const data = await authFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(data);
  state.status = 'conectado';
  return { ok: true };
}

// ---- Dados ----
async function fetchRemote() {
  const rows = await authFetch('/rest/v1/orcamentos?select=dados,atualizado_em');
  return rows && rows[0] ? rows[0] : null;
}

export async function pushNow() {
  if (!isLoggedIn()) return;
  await authFetch('/rest/v1/orcamentos?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      user_id: cfg.session.user.id,
      dados: db,
      atualizado_em: new Date().toISOString(),
    }]),
  });
  state.lastSync = new Date();
}

// ---- Mesclagem (merge) ----
// Nada é apagado por sincronizar: os lançamentos dos dois lados são unidos item a item
// (cada item tem id único). Para o MESMO item alterado nos dois lados, vence o que tem
// _ts mais recente. Exclusões viajam como tombstones em _deleted, para não ressuscitar.
const COLLECTIONS = [
  'banks', 'categoriesExpense', 'categoriesIncome', 'people', 'cards',
  'incomes', 'expenses', 'purchases', 'installments', 'recurring',
  'provisions', 'provisionDeposits', 'investments', 'investContrib',
  'reimbursements', 'rules',
];

function mergeById(a, b, deleted, bWinsTies) {
  const map = new Map();
  const putAll = (list, winsTies) => {
    for (const item of list || []) {
      if (!item || !item.id || deleted[item.id]) continue;
      const cur = map.get(item.id);
      if (!cur) { map.set(item.id, item); continue; }
      const tsCur = Number(cur._ts) || 0;
      const tsNew = Number(item._ts) || 0;
      if (tsNew > tsCur || (tsNew === tsCur && winsTies)) map.set(item.id, item);
    }
  };
  putAll(a, !bWinsTies);
  putAll(b, bWinsTies);
  return [...map.values()];
}

// Catálogos referenciados por NOME (não por id) podem ser deduplicados com segurança —
// evita "XP" em dobro quando os dois aparelhos fizeram o onboarding separadamente.
function dedupeByName(list, keyFn) {
  const seen = new Map();
  for (const item of list) {
    const key = keyFn(item).trim().toLowerCase();
    const cur = seen.get(key);
    if (!cur) seen.set(key, item);
    else if (Array.isArray(cur.sub) && Array.isArray(item.sub)) {
      cur.sub = [...new Set([...cur.sub, ...item.sub])];
    }
  }
  return [...seen.values()];
}

export function mergeDb(local, remote) {
  const remoteNewer = (Number(remote._modified) || 0) > (Number(local._modified) || 0);
  const newer = remoteNewer ? remote : local;
  const older = remoteNewer ? local : remote;
  const deleted = { ...(local._deleted || {}), ...(remote._deleted || {}) };

  const merged = { ...older, ...newer };
  merged.settings = { ...(older.settings || {}), ...(newer.settings || {}) };
  merged.recurringOcc = { ...(older.recurringOcc || {}), ...(newer.recurringOcc || {}) };
  merged._deleted = deleted;
  merged._modified = Math.max(Number(local._modified) || 0, Number(remote._modified) || 0);

  for (const coll of COLLECTIONS) {
    merged[coll] = mergeById(local[coll], remote[coll], deleted, remoteNewer);
  }
  merged.banks = dedupeByName(merged.banks, b => b.nome || '');
  merged.categoriesExpense = dedupeByName(merged.categoriesExpense, c => c.nome || '');
  merged.categoriesIncome = dedupeByName(merged.categoriesIncome, c => c.nome || '');
  merged.rules = dedupeByName(merged.rules, r => `${r.contem}|${r.acao}|${r.valor}`);
  return merged;
}

// Primeiro login em um aparelho: mescla automaticamente com o que existe na nuvem —
// nenhum dos lados apaga o outro.
export async function firstSync() {
  const r = await syncNow();
  return r.changed ? 'mesclado' : 'enviado';
}

// Sincroniza: baixa o remoto, mescla com o local e envia o resultado.
export async function syncNow() {
  if (!isLoggedIn()) return { changed: false };
  state.status = 'sincronizando';
  state.error = '';
  try {
    const remote = await fetchRemote();
    let changed = false;
    if (remote && remote.dados) {
      const merged = mergeDb(db, remote.dados);
      changed = JSON.stringify(merged) !== JSON.stringify(db);
      if (changed) replaceDb(merged);
    }
    await pushNow();
    state.status = 'conectado';
    state.lastSync = new Date();
    return { changed };
  } catch (e) {
    state.status = 'erro';
    state.error = e.message;
    throw e;
  }
}

// ---- Envio automático após cada alteração (com debounce) ----
let pushTimer = null;
function schedulePush() {
  if (!isLoggedIn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushNow().then(() => { state.status = 'conectado'; state.error = ''; })
      .catch(e => { state.status = 'erro'; state.error = e.message; });
  }, 2000);
}

// Inicializa: registra o gancho de save e sincroniza ao abrir/voltar para o app.
let lastFocusSync = 0;
export function init(onRemoteChange) {
  setOnSave(schedulePush);
  const trySync = () => syncNow()
    .then(r => { if (r.changed && onRemoteChange) onRemoteChange(); })
    .catch(() => { /* estado de erro já registrado */ });
  // O listener fica sempre registrado: vale também para quem loga sem recarregar a página.
  window.addEventListener('focus', () => {
    if (!isLoggedIn() || Date.now() - lastFocusSync < 30000) return;
    lastFocusSync = Date.now();
    trySync();
  });
  if (!isLoggedIn()) {
    state.status = isConfigured() ? 'configurado' : 'off';
    return;
  }
  state.status = 'conectado';
  trySync();
}
