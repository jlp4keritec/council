// Storage JSON pour les conversations (v2.12.0 — multi-utilisateur).
// Ecriture atomique (tmp + rename) pour eviter corruption en cas de crash.
//
// Multi-user : chaque conversation porte un champ `owner` (= id utilisateur).
//   - Les conversations créées AVANT le multi-user n'ont pas d'`owner` (legacy).
//     Elles restent visibles par l'ADMIN (le 1er inscrit) le temps de la transition.
//   - getConversation() renvoie la conversation brute (avec `owner`) ; la
//     vérification d'accès se fait via userCanAccess() côté serveur.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

export const SCHEMA_VERSION = 2;

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function conversationPath(id) {
  return join(DATA_DIR, `${id}.json`);
}

// Règle d'accès centralisée.
//   - propriétaire => OK
//   - conversation "legacy" (sans owner) => OK pour l'admin uniquement
export function userCanAccess(conv, user) {
  if (!conv || !user) return false;
  if (conv.owner && conv.owner === user.id) return true;
  if (!conv.owner && user.is_admin) return true;
  return false;
}

export async function createConversation(id, ownerId) {
  await ensureDataDir();
  const conversation = {
    id,
    owner: ownerId || null,
    schema_version: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    title: 'Nouvelle conversation',
    messages: [],
  };
  await saveConversation(conversation);
  return conversation;
}

export async function getConversation(id) {
  try {
    const data = await readFile(conversationPath(id), 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveConversation(conversation) {
  await ensureDataDir();
  const path = conversationPath(conversation.id);
  const tmpPath = path + '.tmp';
  await writeFile(tmpPath, JSON.stringify(conversation, null, 2), 'utf-8');
  await rename(tmpPath, path);
}

// Liste filtrée pour un utilisateur donné.
// `user` = { id, is_admin }. Les conversations legacy (sans owner) ne sont
// renvoyées qu'à l'admin.
export async function listConversations(user) {
  await ensureDataDir();
  const files = await readdir(DATA_DIR);
  const conversations = [];

  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(DATA_DIR, filename), 'utf-8');
      const data = JSON.parse(raw);
      if (user && !userCanAccess(data, user)) continue; // filtrage par propriétaire
      conversations.push({
        id: data.id,
        owner: data.owner || null,
        created_at: data.created_at,
        title: data.title || 'Nouvelle conversation',
        message_count: (data.messages || []).length,
      });
    } catch {
      continue; // fichier corrompu : ignoré
    }
  }

  conversations.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return conversations;
}

export async function addUserMessage(conversationId, content) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} introuvable`);
  conv.messages.push({ role: 'user', content, created_at: new Date().toISOString() });
  await saveConversation(conv);
}

export async function addAssistantMessage(conversationId, { stage1, stage2, stage3, metadata, pricing, timings, failed_models_stage1 }) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} introuvable`);
  conv.messages.push({
    role: 'assistant',
    created_at: new Date().toISOString(),
    stage1, stage2, stage3, metadata, pricing, timings, failed_models_stage1,
  });
  await saveConversation(conv);
}

export async function updateConversationTitle(conversationId, title) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} introuvable`);
  conv.title = title;
  await saveConversation(conv);
}

export async function deleteConversation(id) {
  try {
    await unlink(conversationPath(id));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}
