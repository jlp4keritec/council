// Integration Cortex (second cerveau).
//
// Envoie une deliberation du Council (question + avis du conseil + synthese de
// la presidente) sous forme de NOTE dans Cortex, via son serveur MCP.
//
// Auth : token statique en `Authorization: Bearer <CORTEX_MCP_TOKEN>` (le meme
// MCP_TOKEN que celui utilise par le smoke-test de Cortex). Pas d'OAuth ici :
// c'est un appel machine-a-machine de serveur a serveur.
//
// Transport : JSON-RPC POST sur <CORTEX_MCP_URL>/mcp. La reponse peut etre du
// JSON classique OU du text/event-stream (SSE) — on gere les deux.
//
// La note atterrit dans inbox/ de Cortex (comportement natif de kb_create_note),
// prete a etre relue et consolidee par l'utilisateur.

import { CORTEX_MCP_URL, CORTEX_MCP_TOKEN, CORTEX_NOTE_TAGS } from './config.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_VERSION = '2.11.0';
let rpcId = 0;

function mcpEndpoint() {
  return `${(CORTEX_MCP_URL || '').replace(/\/+$/, '')}/mcp`;
}

// Appel JSON-RPC unique vers le serveur MCP Cortex.
// Renvoie { result, sessionId } ; jette une erreur parlante en cas de souci.
async function rpc(method, params, sessionId) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${CORTEX_MCP_TOKEN}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  let res;
  try {
    res = await fetch(mcpEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
  } catch (err) {
    throw new Error(`Cortex injoignable (${mcpEndpoint()}) : ${err.message}`);
  }

  const newSession = res.headers.get('mcp-session-id') || sessionId || null;
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  if (res.status === 401) {
    throw new Error('Cortex a refusé le token (401). Vérifie CORTEX_MCP_TOKEN dans le .env du Council.');
  }
  if (!res.ok) {
    throw new Error(`Cortex a répondu HTTP ${res.status} : ${raw.slice(0, 200)}`);
  }

  let json = null;
  if (contentType.includes('text/event-stream')) {
    const line = raw.split('\n').find((x) => x.startsWith('data:'));
    json = line ? JSON.parse(line.slice(5).trim()) : null;
  } else {
    try { json = JSON.parse(raw); } catch { /* reponse non-JSON */ }
  }

  if (json && json.error) {
    throw new Error(`Cortex (RPC) : ${json.error.message || JSON.stringify(json.error)}`);
  }
  return { result: json ? json.result : null, sessionId: newSession };
}

// Cree une note dans Cortex. { title, body, tags } -> kb_create_note.
export async function createCortexNote({ title, body, tags }) {
  if (!CORTEX_MCP_TOKEN) {
    throw new Error('CORTEX_MCP_TOKEN manquant dans le .env — impossible d\'écrire dans Cortex.');
  }

  // Handshake MCP (defensif : echange le sessionId si le serveur en exige un).
  const init = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'llm-council', version: SERVER_VERSION },
  });

  const { result } = await rpc(
    'tools/call',
    { name: 'kb_create_note', arguments: { title, body, tags } },
    init.sessionId,
  );

  if (result && result.isError) {
    const txt = (result.content || []).map((c) => c.text).filter(Boolean).join(' ');
    throw new Error(`Cortex a rejeté la note : ${txt || 'erreur inconnue'}`);
  }
  return result;
}

// --------------------------------------------------------------------------
// Mise en forme de la note (selon les conventions du second cerveau)
// --------------------------------------------------------------------------


function shortModel(id) {
  if (!id) return 'IA';
  return String(id).split('/').pop();
}

function truncate(str, n) {
  const s = (str || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
}

function frDate(iso) {
  try {
    return new Date(iso || Date.now()).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function extractQuestion(conv, assistantIndex) {
  const messages = conv.messages || [];
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content || '';
  }
  return '(question introuvable)';
}

// Construit { title, body (Markdown), tags } pret pour kb_create_note.
// Pas de titre H1 dans le corps (Cortex gere le titre), resume en tete,
// sections ##, ton neutre, francais.
export function buildCortexNote(conv, assistantIndex) {
  const msg = conv.messages[assistantIndex];
  const question = extractQuestion(conv, assistantIndex);
  const stage1 = msg.stage1 || [];
  const stage3 = msg.stage3 || {};

  const niceTitle =
    conv.title && conv.title !== 'Nouvelle conversation'
      ? conv.title
      : truncate(question, 70) || 'Délibération LLM Council';

  let body = `Délibération du LLM Council : avis de plusieurs modèles puis synthèse de la présidente, sur la question ci-dessous. Importé depuis LLM Council le ${frDate(msg.created_at)}.\n\n`;

  body += `## Question\n\n${question.trim()}\n\n`;

  body += `## Synthèse (présidente)\n\n`;
  if (stage3.model) body += `*Modèle : ${shortModel(stage3.model)}*\n\n`;
  body += `${stage3.response || '(synthèse non disponible)'}\n\n`;

  body += `## Avis du conseil\n\n`;
  if (stage1.length === 0) {
    body += `(aucun avis individuel enregistré)\n\n`;
  } else {
    stage1.forEach((r) => {
      body += `### ${shortModel(r.model)}\n\n${r.response || '(pas de réponse)'}\n\n`;
    });
  }

  const tags = Array.isArray(CORTEX_NOTE_TAGS) && CORTEX_NOTE_TAGS.length
    ? CORTEX_NOTE_TAGS
    : ['council', 'synthese-ia'];

  return { title: niceTitle, body: body.trim(), tags };
}

// Point d'entree : construit la note depuis la conversation et l'envoie a Cortex.
export async function pushConversationToCortex(conv, assistantIndex) {
  const note = buildCortexNote(conv, assistantIndex);
  await createCortexNote(note);
  return note; // sert a renvoyer titre + tags a l'UI
}
