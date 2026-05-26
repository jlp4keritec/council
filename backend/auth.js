// backend/auth.js v2.8.0
//
// Authentification simple mono-utilisateur pour le LLM Council.
//
// Principe :
//   - Username = ADMIN_USERNAME (.env, defaut "admin")
//   - Password = OPENROUTER_API_KEY (la cle deja en place, double usage)
//   - Cookie httpOnly signe HMAC-SHA256, secret derive de OPENROUTER_API_KEY
//   - Duree de session = SESSION_DURATION_DAYS (.env, defaut 30 jours)
//
// Routes exposees (publiques, hors auth) :
//   POST /api/auth/login   { username, password } -> set-cookie + 200
//   POST /api/auth/logout                          -> clear cookie + 200
//   GET  /api/auth/me                              -> { authenticated, username } | 401
//
// Toutes les autres routes /api/* sont protegees par un preHandler :
//   - Cookie absent ou invalide -> 401
//   - Cookie expire -> 401 (le frontend redirige vers Login)
//
// Note : pas de bcrypt (un seul user, password = API key = string aleatoire
// de 100+ chars). Comparaison constante via crypto.timingSafeEqual.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OPENROUTER_API_KEY, ADMIN_USERNAME, SESSION_DURATION_DAYS } from './config.js';

const COOKIE_NAME = 'llm_council_session';
const SESSION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;

// Secret HMAC derive de la cle OpenRouter (deja secrete, deja en place).
// Si la cle change, toutes les sessions sont invalidees -> comportement attendu.
function getSecret() {
  if (!OPENROUTER_API_KEY) {
    throw new Error('[auth] OPENROUTER_API_KEY manquante : impossible de signer les sessions');
  }
  return createHmac('sha256', 'llm-council-auth-v1').update(OPENROUTER_API_KEY).digest();
}

// -----------------------------------------------------------------------------
// Encodage / decodage des cookies signes
// -----------------------------------------------------------------------------
// Format : base64url(payload).base64url(signature_hmac)

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(
    str.replace(/-/g, '+').replace(/_/g, '/') + pad,
    'base64',
  );
}

function sign(payloadStr) {
  const secret = getSecret();
  const sig = createHmac('sha256', secret).update(payloadStr).digest();
  return b64urlEncode(sig);
}

function createSessionToken(username) {
  const payload = {
    u: username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_MS) / 1000),
    nonce: b64urlEncode(randomBytes(8)),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(payloadStr);
  const signature = sign(payloadStr);
  return `${payloadB64}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signatureGiven] = parts;
  let payloadStr;
  try {
    payloadStr = b64urlDecode(payloadB64).toString('utf-8');
  } catch {
    return null;
  }

  // Verifier la signature en temps constant
  const expectedSig = sign(payloadStr);
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(signatureGiven);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Verifier l'expiration
  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;

  return payload;
}

// -----------------------------------------------------------------------------
// Comparaison password en temps constant
// -----------------------------------------------------------------------------

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  // Toujours faire le timingSafeEqual sur des buffers de meme longueur
  // (sinon il throw). On compare la longueur a la fin pour ne pas leaker
  // la longueur reelle du password via early return.
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(maxLen);
  const padB = Buffer.alloc(maxLen);
  bufA.copy(padA);
  bufB.copy(padB);
  const equal = timingSafeEqual(padA, padB);
  return equal && bufA.length === bufB.length;
}

// -----------------------------------------------------------------------------
// Construction du Set-Cookie header
// -----------------------------------------------------------------------------

function buildCookieValue(token) {
  // En prod (HTTPS) : Secure obligatoire. En dev : on l'enleve sinon le browser refuse le cookie.
  const isProd = process.env.NODE_ENV === 'production' ||
                 process.env.LLM_COUNCIL_FORCE_SECURE === 'true';
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

function buildClearCookieValue() {
  const isProd = process.env.NODE_ENV === 'production' ||
                 process.env.LLM_COUNCIL_FORCE_SECURE === 'true';
  const parts = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

// -----------------------------------------------------------------------------
// Parser un cookie depuis l'en-tete Cookie
// -----------------------------------------------------------------------------

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const items = cookieHeader.split(';').map((s) => s.trim());
  for (const item of items) {
    const eqIdx = item.indexOf('=');
    if (eqIdx === -1) continue;
    const key = item.slice(0, eqIdx);
    if (key === name) return item.slice(eqIdx + 1);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Plugin Fastify : routes /api/auth/* + preHandler pour /api/*
// -----------------------------------------------------------------------------

export function registerAuthPlugin(fastify) {
  // Routes publiques (hors auth)
  const PUBLIC_PATHS = new Set([
    '/api/auth/login',
    '/api/auth/me',     // public pour que le frontend puisse checker sans 401 dans la console
    '/health',
    '/',
  ]);

  // PreHandler global : exige une session valide pour /api/*
  fastify.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url || '';

    // /api/auth/logout passe par auth aussi : pas de panique si session invalide,
    // on accepte de "logger out" un user deja deconnecte
    if (url.startsWith('/api/auth/logout')) return;

    // Routes publiques explicites
    if (PUBLIC_PATHS.has(url.split('?')[0])) return;

    // Pas /api/* -> on laisse passer (ex: /health, healthcheck, etc.)
    if (!url.startsWith('/api/')) return;

    // Verifier le cookie
    const cookie = parseCookie(request.headers.cookie, COOKIE_NAME);
    const payload = verifySessionToken(cookie);
    if (!payload) {
      reply.code(401);
      return reply.send({ error: 'unauthorized', message: 'Session invalide ou expiree' });
    }

    // Stocker l'identite dans la request pour les handlers ulterieurs
    request.user = { username: payload.u };
  });

  // -------------------- POST /api/auth/login --------------------
  fastify.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body || {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      reply.code(400);
      return { error: 'bad_request', message: 'username et password requis' };
    }

    // Comparaison en temps constant (les 2 doivent matcher)
    const usernameOk = constantTimeEqual(username.trim(), ADMIN_USERNAME);
    const passwordOk = constantTimeEqual(password, OPENROUTER_API_KEY);

    if (!usernameOk || !passwordOk) {
      // Pause anti-bruteforce simple (300ms)
      await new Promise((res) => setTimeout(res, 300));
      reply.code(401);
      return { error: 'invalid_credentials', message: 'Identifiants incorrects' };
    }

    const token = createSessionToken(ADMIN_USERNAME);
    reply.header('Set-Cookie', buildCookieValue(token));
    return {
      authenticated: true,
      username: ADMIN_USERNAME,
      expires_in_days: SESSION_DURATION_DAYS,
    };
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
    return {
      authenticated: true,
      username: payload.u,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    };
  });

  fastify.log.info(
    `[auth] Plugin enregistre : user="${ADMIN_USERNAME}", session=${SESSION_DURATION_DAYS}j`,
  );
}
