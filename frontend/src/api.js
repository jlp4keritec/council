// Client API LLM Council.
// En dev : /api est proxy vers localhost:8001 (cf. vite.config.js)
// En prod : Nginx route /api vers le backend Fastify sur localhost:5706
//
// V2.10 : ajout de api.searchConversations (recherche plein-texte dans l'historique).
// V2.8 : credentials: 'include' partout pour que le cookie d'auth soit envoye.
// Au moindre 401, on redirige vers /login (sauf sur les endpoints auth eux-memes
// pour eviter une boucle).

const API_BASE = '/api';

const AUTH_PATHS = ['/auth/login', '/auth/me', '/auth/logout'];

async function jsonRequest(path, options = {}) {
  // N'ajouter Content-Type: application/json QUE s'il y a un corps.
  // Sinon Fastify rejette une requete "vide" (ex: DELETE) en 400
  // FST_ERR_CTP_EMPTY_JSON_BODY ("Body cannot be empty...").
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',     // ENVOYER les cookies
    ...options,
    headers,
  });

  // Auto-redirect sur 401 (sauf si on est sur un endpoint auth)
  if (response.status === 401 && !AUTH_PATHS.some((p) => path.startsWith(p))) {
    // Notifier l'app qu'il faut afficher Login
    window.dispatchEvent(new CustomEvent('auth-required'));
    throw new Error('UNAUTHORIZED');
  }

  // Compte desactive par l'admin -> meme comportement que 401
  if (response.status === 403 && !AUTH_PATHS.some((p) => path.startsWith(p))) {
    const text = await response.clone().text().catch(() => '');
    if (text.includes('account_disabled')) {
      window.dispatchEvent(new CustomEvent('auth-required'));
      throw new Error('ACCOUNT_DISABLED');
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

export const api = {
  // ------------------- AUTH -------------------
  authMe: () => jsonRequest('/auth/me'),

  authSignup: (email, password) =>
    jsonRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  authLogin: (email, password) =>
    jsonRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  authLogout: () =>
    jsonRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),

  // ------------------- COMPTE (v2.14) -------------------
  /** Change le mot de passe. Demande le mot de passe actuel. */
  authChangePassword: (currentPassword, newPassword) =>
    jsonRequest('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  /** Change l'email. Demande le mot de passe actuel. */
  authChangeEmail: (newEmail, currentPassword) =>
    jsonRequest('/auth/email', {
      method: 'PATCH',
      body: JSON.stringify({ new_email: newEmail, current_password: currentPassword }),
    }),

  /** Supprime le compte (et toutes ses conversations). Demande le mot de passe actuel. */
  authDeleteAccount: (currentPassword) =>
    jsonRequest('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ current_password: currentPassword }),
    }),

  // ------------------- CLE OPENROUTER (v2.15) -------------------
  /** Enregistre la cle OpenRouter de l'utilisateur (chiffree cote serveur). */
  authSetOpenRouterKey: (apiKey) =>
    jsonRequest('/auth/openrouter-key', {
      method: 'PUT',
      body: JSON.stringify({ api_key: apiKey }),
    }),

  /** Supprime la cle OpenRouter de l'utilisateur. */
  authClearOpenRouterKey: () =>
    jsonRequest('/auth/openrouter-key', { method: 'DELETE' }),

  /**
   * Teste une cle aupres d'OpenRouter (sans la stocker si elle est passee).
   * Si apiKey est omise, teste la cle deja enregistree.
   */
  authTestOpenRouterKey: (apiKey = null) =>
    jsonRequest('/auth/openrouter-key/test', {
      method: 'POST',
      body: JSON.stringify(apiKey ? { api_key: apiKey } : {}),
    }),

  // ------------------- CONFIG CORTEX (v2.17) -------------------
  /** Lit la config Cortex de l'utilisateur : { has_cortex, cortex_url }. */
  authGetCortexConfig: () => jsonRequest('/auth/cortex-config'),

  /** Enregistre l'URL + le token Cortex (token chiffre cote serveur). */
  authSetCortexConfig: (url, token) =>
    jsonRequest('/auth/cortex-config', {
      method: 'PUT',
      body: JSON.stringify({ url, token }),
    }),

  /** Supprime la config Cortex de l'utilisateur. */
  authClearCortexConfig: () =>
    jsonRequest('/auth/cortex-config', { method: 'DELETE' }),

  /**
   * Teste la connexion Cortex. Si url/token passes, teste ceux-la (avant
   * enregistrement). Sinon, teste la config deja enregistree.
   */
  authTestCortexConfig: (url = null, token = null) =>
    jsonRequest('/auth/cortex-config/test', {
      method: 'POST',
      body: JSON.stringify(token ? { url, token } : {}),
    }),

  // ------------------- ADMIN (v2.16) -------------------
  /** Liste tous les utilisateurs + stats (admin uniquement). */
  adminListUsers: () => jsonRequest('/admin/users'),

  /** Active / desactive un utilisateur. */
  adminSetActive: (userId, isActive) =>
    jsonRequest(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    }),

  /** Promeut / retrograde admin. */
  adminSetAdmin: (userId, isAdmin) =>
    jsonRequest(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_admin: isAdmin }),
    }),

  /** Reset du mot de passe (renvoie un mot de passe temporaire genere). */
  adminResetPassword: (userId) =>
    jsonRequest(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Suppression d'un compte par l'admin (+ ses conversations). */
  adminDeleteUser: (userId) =>
    jsonRequest(`/admin/users/${userId}`, { method: 'DELETE' }),

  // ------------------- CONFIG / USAGE -------------------
  getConfig: () => jsonRequest('/config'),

  getUsage: () => jsonRequest('/usage'),

  /**
   * Recherche dans la liste des modeles OpenRouter (cache cote serveur 1h).
   */
  getModels: ({ search = '', pricing = 'all', limit = 50 } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (pricing && pricing !== 'all') params.set('pricing', pricing);
    if (limit) params.set('limit', String(limit));
    const q = params.toString();
    return jsonRequest(`/models${q ? `?${q}` : ''}`);
  },

  /**
   * Health check d'une liste de modeles.
   */
  checkHealth: (models, forceRefresh = false) =>
    jsonRequest('/models/health', {
      method: 'POST',
      body: JSON.stringify({ models, force_refresh: forceRefresh }),
    }),

  // ------------------- CONVERSATIONS -------------------
  listConversations: () => jsonRequest('/conversations'),

  createConversation: () =>
    jsonRequest('/conversations', { method: 'POST', body: JSON.stringify({}) }),

  getConversation: (id) => jsonRequest(`/conversations/${id}`),

  deleteConversation: (id) =>
    jsonRequest(`/conversations/${id}`, { method: 'DELETE' }),

  /**
   * Recherche filtree dans l'historique.
   * @param {object} criteria - { q, date_from, date_to, judge, chairman }
   */
  searchConversations: (criteria = {}) => {
    const params = new URLSearchParams();
    if (criteria.q) params.set('q', criteria.q);
    if (criteria.date_from) params.set('date_from', criteria.date_from);
    if (criteria.date_to) params.set('date_to', criteria.date_to);
    if (criteria.judge) params.set('judge', criteria.judge);
    if (criteria.chairman) params.set('chairman', criteria.chairman);
    const qs = params.toString();
    return jsonRequest(`/search${qs ? `?${qs}` : ''}`);
  },

  /** Liste des juges / presidents presents dans l'historique. */
  getSearchFacets: () => jsonRequest('/search/facets'),

  /**
   * Envoie une délibération (question + avis + synthèse) dans Cortex (inbox).
   */
  sendToCortex: (conversationId, messageIndex) =>
    jsonRequest(`/conversations/${conversationId}/to-cortex`, {
      method: 'POST',
      body: JSON.stringify({ message_index: messageIndex }),
    }),

  exportUrl: (conversationId, format, messageIndex) => {
    const params = new URLSearchParams({ format });
    if (messageIndex != null) params.set('message_index', String(messageIndex));
    return `${API_BASE}/conversations/${conversationId}/export?${params}`;
  },

  /**
   * Streaming pipeline council via SSE.
   */
  async sendMessageStream(conversationId, content, onEvent, override = null) {
    const body = { content };
    if (override) body.override = override;

    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      },
    );

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('auth-required'));
      throw new Error('UNAUTHORIZED');
    }
    if (!response.ok) throw new Error(`API ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evt of events) {
        const lines = evt.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              onEvent(payload);
            } catch (e) {
              console.warn('SSE parse failed:', line, e);
            }
          }
        }
      }
    }
  },
};
