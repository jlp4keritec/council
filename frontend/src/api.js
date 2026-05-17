// Client API LLM Council.
// En dev : /api est proxy vers localhost:8001 (cf. vite.config.js)
// En prod : Nginx route /api vers le backend FastAPI sur localhost:8001

const API_BASE = '/api';

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

export const api = {
  getConfig: () => jsonRequest('/config'),

  getUsage: () => jsonRequest('/usage'),

  /**
   * Recherche dans la liste des modeles OpenRouter (cache cote serveur 1h).
   * @param {object} opts {search, pricing: 'all'|'free'|'paid', limit}
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
   * Health check d'une liste de modeles. Consomme 1 requete de quota par
   * modele non-cache (cache serveur de 5 min, bypass avec forceRefresh).
   * @returns {Promise<{results, summary}>}
   */
  checkHealth: (models, forceRefresh = false) =>
    jsonRequest('/models/health', {
      method: 'POST',
      body: JSON.stringify({ models, force_refresh: forceRefresh }),
    }),

  listConversations: () => jsonRequest('/conversations'),

  createConversation: () =>
    jsonRequest('/conversations', { method: 'POST', body: JSON.stringify({}) }),

  getConversation: (id) => jsonRequest(`/conversations/${id}`),

  deleteConversation: (id) =>
    jsonRequest(`/conversations/${id}`, { method: 'DELETE' }),

  /**
   * Build l'URL d'export d'un message. format = md|json|docx|pptx.
   * Le frontend laisse simplement le navigateur télécharger en visitant cette URL
   * (pas besoin de gérer le buffer côté JS).
   */
  exportUrl: (conversationId, format, messageIndex) => {
    const params = new URLSearchParams({ format });
    if (messageIndex != null) params.set('message_index', String(messageIndex));
    return `${API_BASE}/conversations/${conversationId}/export?${params}`;
  },

  /**
   * Streaming pipeline council via SSE.
   * @param {string} conversationId
   * @param {string} content
   * @param {(event: object) => void} onEvent  callback appele a chaque event SSE
   * @param {object} override  optionnel : {council_models, chairman_model, title_model, eval_criteria}
   */
  async sendMessageStream(conversationId, content, onEvent, override = null) {
    const body = { content };
    if (override) body.override = override;

    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

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
