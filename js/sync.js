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

export function setConfig(url, anonKey) {
  cfg.url = url.replace(/\/+$/, '');
  cfg.anonKey = anonKey.trim();
  saveCfg();
  state.status = 'configurado';
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

// Primeiro login em um aparelho: se já existem dados na nuvem, quem decide é a usuária
// (evita que o onboarding recém-feito sobrescreva a base real).
export async function firstSync() {
  const remote = await fetchRemote();
  if (!remote) { await pushNow(); return 'enviado'; }
  return 'nuvem-existe';
}

export async function adoptRemote() {
  const remote = await fetchRemote();
  if (remote) { replaceDb(remote.dados); state.lastSync = new Date(); }
}

// Sincroniza: baixa o remoto; se for mais novo que o local, substitui; senão, envia o local.
export async function syncNow() {
  if (!isLoggedIn()) return { changed: false };
  state.status = 'sincronizando';
  state.error = '';
  try {
    const remote = await fetchRemote();
    const localMod = Number(db._modified) || 0;
    const remoteMod = remote ? Number(remote.dados?._modified) || Date.parse(remote.atualizado_em) || 0 : 0;
    let changed = false;
    if (remote && remoteMod > localMod) {
      replaceDb(remote.dados);
      changed = true;
    } else {
      await pushNow();
    }
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
