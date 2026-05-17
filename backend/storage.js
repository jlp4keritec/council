// Storage JSON pour les conversations.
// Ecriture atomique (tmp + rename) pour eviter corruption en cas de crash.

import { mkdir, readdir, readFile, rename, unlink, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

export const SCHEMA_VERSION = 2;

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function conversationPath(id) {
  return join(DATA_DIR, `${id}.json`);
}

export async function createConversation(id) {
  await ensureDataDir();
  const conversation = {
    id,
    schema_version: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    title: 'Nouvelle conversation',
    messages: [],
  };
  await saveConversation(conversation);
  return conversation;
}

export async function getConversation(id) {
  const path = conversationPath(id);
  try {
    const data = await readFile(path, 'utf-8');
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
  // Ecriture atomique : tmp + rename
  await writeFile(tmpPath, JSON.stringify(conversation, null, 2), 'utf-8');
  await rename(tmpPath, path);
}

export async function listConversations() {
  await ensureDataDir();
  const files = await readdir(DATA_DIR);
  const conversations = [];

  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    const path = join(DATA_DIR, filename);
    try {
      const raw = await readFile(path, 'utf-8');
      const data = JSON.parse(raw);
      conversations.push({
        id: data.id,
        created_at: data.created_at,
        title: data.title || 'Nouvelle conversation',
        message_count: (data.messages || []).length,
      });
    } catch {
      // Fichier corrompu : on l'ignore silencieusement
      continue;
    }
  }

  conversations.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return conversations;
}

export async function addUserMessage(conversationId, content) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} introuvable`);

  conv.messages.push({
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  });
  await saveConversation(conv);
}

export async function addAssistantMessage(conversationId, { stage1, stage2, stage3, metadata, pricing, timings, failed_models_stage1 }) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} introuvable`);

  conv.messages.push({
    role: 'assistant',
    created_at: new Date().toISOString(),
    stage1,
    stage2,
    stage3,
    metadata,    // label_to_model + aggregate_rankings
    pricing,     // total tokens + cout USD par stage
    timings,     // duree par stage + total
    failed_models_stage1,   // IDs des modeles qui n'ont pas repondu en Stage 1
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
  const path = conversationPath(id);
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}
