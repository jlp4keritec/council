// Grounding juridique : interroge un serveur MCP de sources (DILA, Legifrance...)
// et renvoie un bloc de texte a injecter en contexte du Stage 1.
//
// PRINCIPE DE SECURITE (fail-open) : ce module ne LANCE JAMAIS d'exception vers
// l'appelant. Toute erreur (config absente, MCP injoignable, outil inconnu,
// timeout, auth) -> il renvoie null, et le pipeline continue SANS grounding.
// Activer le grounding ne peut donc pas casser une deliberation.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  GROUNDING_ENABLED,
  GROUNDING_MCP_URL,
  GROUNDING_MCP_TOOL,
  GROUNDING_MCP_QUERY_PARAM,
  GROUNDING_MCP_AUTH,
  GROUNDING_MAX_RESULTS,
  GROUNDING_TIMEOUT,
  GROUNDING_MAX_CHARS,
} from './config.js';

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * Extrait du texte lisible d'un resultat d'outil MCP (content blocks).
 * Les serveurs MCP renvoient typiquement { content: [{type:'text', text:'...'}] }.
 */
function extractText(toolResult) {
  if (!toolResult) return '';
  // structuredContent (JSON) eventuel
  if (toolResult.structuredContent) {
    try { return JSON.stringify(toolResult.structuredContent, null, 2); } catch { /* ignore */ }
  }
  const content = toolResult.content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n\n');
  }
  if (typeof toolResult === 'string') return toolResult;
  return '';
}

/**
 * Interroge le serveur MCP de grounding pour une requete donnee.
 * @param {string} query
 * @returns {Promise<{ text: string, tool: string, url: string } | null>}
 *          null si desactive, mal configure, ou en cas de toute erreur.
 */
export async function fetchGrounding(query) {
  if (!GROUNDING_ENABLED) return null;
  if (!GROUNDING_MCP_URL) {
    console.warn('Grounding active mais GROUNDING_MCP_URL vide -> ignore');
    return null;
  }
  if (!query || typeof query !== 'string') return null;

  let client = null;
  let transport = null;

  try {
    const requestInit = GROUNDING_MCP_AUTH
      ? { headers: { Authorization: GROUNDING_MCP_AUTH } }
      : undefined;

    transport = new StreamableHTTPClientTransport(new URL(GROUNDING_MCP_URL), { requestInit });
    client = new Client(
      { name: 'llm-council-grounding', version: '1.0.0' },
      { capabilities: {} },
    );

    await withTimeout(client.connect(transport), GROUNDING_TIMEOUT, 'MCP connect');

    const args = {
      [GROUNDING_MCP_QUERY_PARAM]: query,
      // de nombreux outils acceptent une limite ; inoffensif si ignore
      limit: GROUNDING_MAX_RESULTS,
    };

    const result = await withTimeout(
      client.callTool({ name: GROUNDING_MCP_TOOL, arguments: args }),
      GROUNDING_TIMEOUT,
      'MCP callTool',
    );

    let text = extractText(result).trim();
    if (!text) return null;
    if (text.length > GROUNDING_MAX_CHARS) {
      text = text.slice(0, GROUNDING_MAX_CHARS) + '\n[...] (tronque)';
    }

    return { text, tool: GROUNDING_MCP_TOOL, url: GROUNDING_MCP_URL };
  } catch (err) {
    // fail-open : on log et on renvoie null, le pipeline continue sans grounding
    console.warn(`Grounding ignore (${GROUNDING_MCP_TOOL} @ ${GROUNDING_MCP_URL}) : ${err.message}`);
    return null;
  } finally {
    try { if (client) await client.close(); } catch { /* ignore */ }
    try { if (transport) await transport.close(); } catch { /* ignore */ }
  }
}
