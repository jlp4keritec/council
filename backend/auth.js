// backend/auth.js v2.12.0 — Authentification MULTI-UTILISATEUR
//
// Évolution depuis la v2.8 (mono-user) :
//   - Inscription libre : email + mot de passe (POST /api/auth/signup)
//   - Connexion par email + mot de passe (POST /api/auth/login)
//   - Sessions par utilisateur : le cookie contient l'ID utilisateur (uid)
//   - Mots de passe hachés (scrypt) via backend/users.js
//
// Cookie : httpOnly, signé HMAC-SHA256 avec un secret SERVEUR (SESSION_SECRET,
// ou dérivé de OPENROUTER_API_KEY par défaut — stable, partagé par tous).
//
// Routes publiques (hors auth) :
//   POST /api/auth/signup  { email, password } -> set-cookie + user
//   POST /api/auth/login   { email, password } -> set-cookie + user
//   POST /api/auth/logout                        -> clear cookie
//   GET  /api/auth/me                            -> { authenticated, ... } | 401
//
// Les autres routes /api/* exigent une session valide ; request.user = { id, email, is_admin }.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  SESSION_SECRET, SESSION_DURATION_DAYS, PASSWORD_MIN_LENGTH,
} from './config.js';
import * as users from './users.js';
import { testCortexConnection } from './cortex.js';

const COOKIE_NAME = 'llm_council_session';
const SESSION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getSecret() {
  if (!SESSION_SECRET) {
    throw new Error('[auth] SESSION_SECRET indisponible : impossible de signer les sessions');
  }
  return createHmac('sha256', 'llm-council-auth-v2').update(SESSION_SECRET).digest();
}

// -----------------------------------------------------------------------------
// Cookies signés : base64url(payload).base64url(hmac)
// -----------------------------------------------------------------------------

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
function sign(payloadStr) {
  return b64urlEncode(createHmac('sha256', getSecret()).update(payloadStr).digest());
}

function createSessionToken(user) {
  const payload = {
    uid: user.id,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_MS) / 1000),
    nonce: b64urlEncode(randomBytes(8)),
  };
  const payloadStr = JSON.stringify(payload);
  return `${b64urlEncode(payloadStr)}.${sign(payloadStr)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigGiven] = parts;
  let payloadStr;
  try { payloadStr = b64urlDecode(payloadB64).toString('utf-8'); } catch { return null; }

  const expectedSig = sign(payloadStr);
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(sigGiven);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try { payload = JSON.parse(payloadStr); } catch { return null; }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// -----------------------------------------------------------------------------
// Set-Cookie helpers
// -----------------------------------------------------------------------------

function isProd() {
  return process.env.NODE_ENV === 'production' || process.env.LLM_COUNCIL_FORCE_SECURE === 'true';
}
function buildCookieValue(token) {
  const parts = [
    `${COOKIE_NAME}=${token}`, `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}
function buildClearCookieValue() {
  const parts = [`${COOKIE_NAME}=`, 'Max-Age=0', 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';').map((s) => s.trim())) {
    const eq = item.indexOf('=');
    if (eq === -1) continue;
    if (item.slice(0, eq) === name) return item.slice(eq + 1);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Petit garde anti-bruteforce en mémoire (par IP). Se réinitialise au redémarrage.
// -----------------------------------------------------------------------------

const attempts = new Map(); // ip -> { count, first }
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 20;

function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

// -----------------------------------------------------------------------------
// Plugin Fastify
// -----------------------------------------------------------------------------

export function registerAuthPlugin(fastify) {
  const PUBLIC_PATHS = new Set([
    '/api/auth/signup',
    '/api/auth/login',
    '/api/auth/me',
    '/health',
    '/',
  ]);

  fastify.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url || '';
    if (url.startsWith('/api/auth/logout')) return;
    if (PUBLIC_PATHS.has(url.split('?')[0])) return;
    if (!url.startsWith('/api/')) return;

    const cookie = parseCookie(request.headers.cookie, COOKIE_NAME);
    const payload = verifySessionToken(cookie);
    if (!payload) {
      reply.code(401);
      return reply.send({ error: 'unauthorized', message: 'Session invalide ou expirée' });
    }
    // Recharger l'utilisateur (pour récupérer is_admin / has_key à jour)
    const u = await users.findById(payload.uid);
    if (!u) {
      reply.code(401);
      return reply.send({ error: 'unauthorized', message: 'Compte introuvable' });
    }
    if (u.is_disabled) {
      reply.code(403);
      reply.header('Set-Cookie', buildClearCookieValue());
      return reply.send({ error: 'account_disabled', message: 'Ce compte a été désactivé par l\'administrateur.' });
    }
    request.user = { id: u.id, email: u.email, is_admin: !!u.is_admin, has_key: !!u.openrouter_key_enc };
  });

  // -------------------- POST /api/auth/signup --------------------
  fastify.post('/api/auth/signup', async (request, reply) => {
    const ip = request.ip || 'unknown';
    if (tooManyAttempts(ip)) {
      reply.code(429);
      return { error: 'too_many', message: 'Trop de tentatives. Réessaie dans quelques minutes.' };
    }
    const { email, password } = request.body || {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      reply.code(400);
      return { error: 'bad_email', message: 'Adresse email invalide.' };
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      reply.code(400);
      return { error: 'weak_password', message: `Mot de passe trop court (au moins ${PASSWORD_MIN_LENGTH} caractères).` };
    }
    try {
      const user = await users.createUser(email, password);
      const token = createSessionToken(user);
      reply.header('Set-Cookie', buildCookieValue(token));
      fastify.log.info(`[auth] inscription : ${user.email}${user.is_admin ? ' (admin)' : ''}`);
      return { authenticated: true, ...user, expires_in_days: SESSION_DURATION_DAYS };
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') {
        reply.code(409);
        return { error: 'email_taken', message: err.message };
      }
      throw err;
    }
  });

  // -------------------- POST /api/auth/login --------------------
  fastify.post('/api/auth/login', async (request, reply) => {
    const ip = request.ip || 'unknown';
    if (tooManyAttempts(ip)) {
      reply.code(429);
      return { error: 'too_many', message: 'Trop de tentatives. Réessaie dans quelques minutes.' };
    }
    const { email, password } = request.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      reply.code(400);
      return { error: 'bad_request', message: 'email et mot de passe requis' };
    }
    const user = await users.authenticate(email, password);
    if (!user) {
      await new Promise((res) => setTimeout(res, 300)); // anti-bruteforce
      reply.code(401);
      return { error: 'invalid_credentials', message: 'Email ou mot de passe incorrect.' };
    }
    // Compte desactive : refuser meme avec le bon mot de passe
    const full = await users.findById(user.id);
    if (full && full.is_disabled) {
      reply.code(403);
      return { error: 'account_disabled', message: 'Ce compte a été désactivé par l\'administrateur.' };
    }
    const token = createSessionToken(user);
    reply.header('Set-Cookie', buildCookieValue(token));
    return { authenticated: true, ...user, expires_in_days: SESSION_DURATION_DAYS };
  });

  // -------------------- POST /api/auth/logout --------------------
  fastify.post('/api/auth/logout', async (request, reply) => {
    reply.header('Set-Cookie', buildClearCookieValue());
    return { authenticated: false };
  });

  // -------------------- GET /api/auth/me --------------------
  fastify.get('/api/auth/me', async (request, reply) => {
    const cookie = parseCookie(request.headers.cookie, COOKIE_NAME);
    const payload = verifySessionToken(cookie);
    if (!payload) {
      reply.code(401);
      return { authenticated: false };
    }
    const u = await users.findById(payload.uid);
    if (!u) {
      reply.code(401);
      return { authenticated: false };
    }
    return {
      authenticated: true,
      id: u.id,
      email: u.email,
      username: u.email, // compat frontend existant (affichage)
      is_admin: !!u.is_admin,
      has_key: !!u.openrouter_key_enc,
      has_cortex: !!u.cortex_token_enc,
      cortex_url: u.cortex_url || null,
      created_at: u.created_at,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    };
  });

  fastify.log.info(`[auth] Multi-user activé · session=${SESSION_DURATION_DAYS}j`);

  // ===========================================================================
  // Compte utilisateur (v2.14) — modifications, suppression
  // ===========================================================================
  // Toutes ces routes exigent une session valide (deja garantie par le preHandler).
  // Chacune redemande le MOT DE PASSE ACTUEL pour confirmer l'identite.

  // PATCH /api/auth/password { current_password, new_password }
  fastify.patch('/api/auth/password', async (request, reply) => {
    const { current_password, new_password } = request.body || {};
    if (typeof current_password !== 'string' || typeof new_password !== 'string') {
      reply.code(400);
      return { error: 'bad_request', message: 'Mot de passe actuel et nouveau requis.' };
    }
    if (new_password.length < PASSWORD_MIN_LENGTH) {
      reply.code(400);
      return { error: 'weak_password', message: `Nouveau mot de passe trop court (au moins ${PASSWORD_MIN_LENGTH} caractères).` };
    }
    try {
      const updated = await users.updatePassword(request.user.id, current_password, new_password);
      fastify.log.info(`[auth] mot de passe change : ${updated.email}`);
      return { ok: true };
    } catch (err) {
      if (err.code === 'BAD_CURRENT_PASSWORD') {
        reply.code(401);
        return { error: 'bad_current', message: err.message };
      }
      throw err;
    }
  });

  // PATCH /api/auth/email { new_email, current_password }
  fastify.patch('/api/auth/email', async (request, reply) => {
    const { new_email, current_password } = request.body || {};
    if (typeof new_email !== 'string' || !EMAIL_RE.test(new_email.trim())) {
      reply.code(400);
      return { error: 'bad_email', message: 'Adresse email invalide.' };
    }
    if (typeof current_password !== 'string') {
      reply.code(400);
      return { error: 'bad_request', message: 'Mot de passe actuel requis.' };
    }
    try {
      const updated = await users.updateEmail(request.user.id, new_email, current_password);
      // Re-emettre le cookie avec le nouvel email dans le payload (cosmetique)
      const token = createSessionToken({ id: updated.id, email: updated.email });
      reply.header('Set-Cookie', buildCookieValue(token));
      fastify.log.info(`[auth] email change : ${updated.email}`);
      return { ok: true, email: updated.email };
    } catch (err) {
      if (err.code === 'BAD_CURRENT_PASSWORD') {
        reply.code(401);
        return { error: 'bad_current', message: err.message };
      }
      if (err.code === 'EMAIL_TAKEN') {
        reply.code(409);
        return { error: 'email_taken', message: err.message };
      }
      throw err;
    }
  });

  // DELETE /api/auth/account { current_password }
  // Supprime aussi toutes les conversations possedees par l'utilisateur.
  fastify.delete('/api/auth/account', async (request, reply) => {
    const { current_password } = request.body || {};
    if (typeof current_password !== 'string') {
      reply.code(400);
      return { error: 'bad_request', message: 'Mot de passe actuel requis.' };
    }
    try {
      // 1) suppression des conversations de l'utilisateur (uniquement les siennes)
      const storage = await import('./storage.js');
      const list = await storage.listConversations(request.user);
      let removed = 0;
      for (const item of list) {
        if (item.owner === request.user.id) {
          if (await storage.deleteConversation(item.id)) removed += 1;
        }
      }
      // 2) suppression du compte (avec verification du mot de passe)
      await users.deleteUser(request.user.id, current_password);
      reply.header('Set-Cookie', buildClearCookieValue());
      fastify.log.info(`[auth] compte supprime + ${removed} conversations`);
      return { ok: true, deleted_conversations: removed };
    } catch (err) {
      if (err.code === 'BAD_CURRENT_PASSWORD') {
        reply.code(401);
        return { error: 'bad_current', message: err.message };
      }
      throw err;
    }
  });

  // ===========================================================================
  // Cle OpenRouter par utilisateur (v2.15)
  // ===========================================================================

  // PUT /api/auth/openrouter-key { api_key }
  fastify.put('/api/auth/openrouter-key', async (request, reply) => {
    const { api_key } = request.body || {};
    if (typeof api_key !== 'string' || api_key.trim().length < 10) {
      reply.code(400);
      return { error: 'bad_key', message: 'Clé invalide (trop courte). Elle doit commencer par sk-or-…' };
    }
    try {
      await users.setOpenRouterKey(request.user.id, api_key);
      fastify.log.info(`[auth] cle OpenRouter enregistree pour ${request.user.email}`);
      return { ok: true, has_key: true };
    } catch (err) {
      reply.code(500);
      return { error: 'internal', message: err.message || 'Erreur lors de l\'enregistrement.' };
    }
  });

  // DELETE /api/auth/openrouter-key
  fastify.delete('/api/auth/openrouter-key', async (request) => {
    await users.clearOpenRouterKey(request.user.id);
    return { ok: true, has_key: false };
  });

  // POST /api/auth/openrouter-key/test  -> verifie via /api/v1/key d'OpenRouter
  // Body optionnel : { api_key } pour tester une cle AVANT de l'enregistrer.
  fastify.post('/api/auth/openrouter-key/test', async (request, reply) => {
    let keyToTest = null;
    if (request.body && typeof request.body.api_key === 'string' && request.body.api_key.trim().length >= 10) {
      keyToTest = request.body.api_key.trim();
    } else {
      keyToTest = await users.getDecryptedKey(request.user.id);
    }
    if (!keyToTest) {
      reply.code(400);
      return { ok: false, error: 'no_key', message: 'Aucune clé à tester. Colle ta clé et réessaie.' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${keyToTest}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'invalid', message: 'OpenRouter refuse cette clé (401/403). Vérifie qu\'elle est bien copiée et active.' };
      }
      if (!res.ok) {
        return { ok: false, error: 'http', message: `OpenRouter a répondu HTTP ${res.status}.` };
      }
      const data = await res.json();
      // OpenRouter renvoie typiquement { data: { label, usage, limit, ... } }
      const info = (data && data.data) || data || {};
      return {
        ok: true,
        message: 'Clé valide ✓',
        details: {
          label: info.label || null,
          usage: info.usage ?? null,
          limit: info.limit ?? null,
          is_free_tier: info.is_free_tier ?? null,
        },
      };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'network', message: `Impossible de joindre OpenRouter : ${err.message}` };
    }
  });

  // ===========================================================================
  // Config Cortex par utilisateur (v2.17)
  // ===========================================================================

  // GET /api/auth/cortex-config -> { has_cortex, cortex_url } (jamais le token)
  fastify.get('/api/auth/cortex-config', async (request) => {
    const u = await users.findById(request.user.id);
    return {
      has_cortex: !!(u && u.cortex_token_enc),
      cortex_url: (u && u.cortex_url) || null,
    };
  });

  // PUT /api/auth/cortex-config { url, token }
  fastify.put('/api/auth/cortex-config', async (request, reply) => {
    const { url, token } = request.body || {};
    if (typeof token !== 'string' || token.trim().length < 8) {
      reply.code(400);
      return { error: 'bad_token', message: 'Token Cortex invalide (trop court).' };
    }
    try {
      const updated = await users.setCortexConfig(request.user.id, url, token);
      fastify.log.info(`[auth] config Cortex enregistree pour ${request.user.email}`);
      return { ok: true, has_cortex: true, cortex_url: updated.cortex_url || null };
    } catch (err) {
      reply.code(500);
      return { error: 'internal', message: err.message || 'Erreur lors de l\'enregistrement.' };
    }
  });

  // DELETE /api/auth/cortex-config
  fastify.delete('/api/auth/cortex-config', async (request) => {
    await users.clearCortexConfig(request.user.id);
    return { ok: true, has_cortex: false };
  });

  // POST /api/auth/cortex-config/test  -> handshake MCP (sans creer de note)
  // Body optionnel : { url, token } pour tester AVANT d'enregistrer.
  fastify.post('/api/auth/cortex-config/test', async (request, reply) => {
    let conn = null;
    const b = request.body || {};
    if (typeof b.token === 'string' && b.token.trim().length >= 8) {
      conn = { url: (b.url || '').trim() || null, token: b.token.trim() };
    } else {
      conn = await users.getCortexConfig(request.user.id);
    }
    if (!conn || !conn.token) {
      reply.code(400);
      return { ok: false, error: 'no_token', message: 'Aucun token à tester. Renseigne ton token et réessaie.' };
    }
    try {
      await testCortexConnection(conn);
      return { ok: true, message: 'Connexion Cortex OK ✓' };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: 'network', message: err.message || 'Connexion Cortex impossible.' };
    }
  });
}
