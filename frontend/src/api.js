// Client API LLM Council.
// En dev : /api est proxy vers localhost:8001 (cf. vite.config.js)
// En prod : Nginx route /api vers le backend Fastify sur localhost:5706
//
// V2.8 : credentials: 'include' partout pour que le cookie d'auth soit envoye.
// Au moindre 401, on redirige vers /login (sauf sur les endpoints auth eux-memes
// pour eviter une boucle).

const API_BASE = '/api';

const AUTH_PATHS = ['/auth/login', '/auth/me', '/auth/logout'];

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'include',     // ENVOYER les cookies
    ...options,
  });

  // Auto-redirect sur 401 (sauf si on est sur un endpoint auth)
  if (response.status === 401 && !AUTH_PATHS.some((p) => path.startsWith(p))) {
    // Notifier l'app qu'il faut afficher Login
    window.dispatchEvent(new CustomEvent('auth-required'));
    throw new Error('UNAUTHORIZED');
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

  authLogin: (username, password) =>
    jsonRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  authLogout: () =>
    jsonRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),

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
