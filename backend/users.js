// backend/users.js — magasin d'utilisateurs (multi-user, v2.12.0)
//
// Stockage : un fichier JSON unique (data/users.json), ecriture atomique.
// Mots de passe : haches avec scrypt (intégré à Node, AUCUNE dépendance externe)
// + sel aléatoire par utilisateur. Jamais stockés en clair.
//
// Champs d'un utilisateur :
//   id            : identifiant interne (UUID), utilisé pour rattacher les conversations
//   email         : email saisi (affichage)
//   email_lower   : email en minuscules (unicité / recherche)
//   password_hash : "scrypt$<saltHex>$<hashHex>"
//   is_admin      : true pour le 1er inscrit (récupère les conversations "héritées")
//   created_at    : ISO
//   openrouter_key_enc : null pour l'instant (rempli à l'Étape 2, chiffré)
//
// Concurrence : app à faible trafic, on charge en mémoire + écriture immédiate.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { USERS_FILE } from './config.js';

// ---------------------------------------------------------------------------
// Hachage de mot de passe (scrypt)
// ---------------------------------------------------------------------------

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const derived = scryptSync(plain, salt, expected.length);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistance
// ---------------------------------------------------------------------------

let cache = null; // { users: [...] }

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await readFile(USERS_FILE, 'utf-8');
    cache = JSON.parse(raw);
    if (!cache || !Array.isArray(cache.users)) cache = { users: [] };
  } catch (err) {
    if (err.code === 'ENOENT') cache = { users: [] };
    else throw err;
  }
  return cache;
}

async function persist() {
  await mkdir(dirname(USERS_FILE), { recursive: true });
  const tmp = USERS_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf-8');
  await rename(tmp, USERS_FILE);
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    is_admin: !!u.is_admin,
    created_at: u.created_at,
    has_key: !!u.openrouter_key_enc,
  };
}

export async function findByEmail(email) {
  const db = await ensureLoaded();
  const lower = String(email || '').trim().toLowerCase();
  return db.users.find((u) => u.email_lower === lower) || null;
}

export async function findById(id) {
  const db = await ensureLoaded();
  return db.users.find((u) => u.id === id) || null;
}

export async function countUsers() {
  const db = await ensureLoaded();
  return db.users.length;
}

// Crée un utilisateur. Renvoie l'objet public, ou jette une erreur parlante.
export async function createUser(email, plainPassword) {
  const db = await ensureLoaded();
  const cleanEmail = String(email || '').trim();
  const lower = cleanEmail.toLowerCase();

  if (db.users.some((u) => u.email_lower === lower)) {
    const e = new Error('Un compte existe déjà avec cet email.');
    e.code = 'EMAIL_TAKEN';
    throw e;
  }

  const isFirst = db.users.length === 0; // le 1er inscrit devient admin
  const user = {
    id: randomUUID(),
    email: cleanEmail,
    email_lower: lower,
    password_hash: hashPassword(plainPassword),
    is_admin: isFirst,
    created_at: new Date().toISOString(),
    openrouter_key_enc: null, // rempli à l'Étape 2
  };
  db.users.push(user);
  await persist();
  return publicUser(user);
}

// Vérifie email + mot de passe. Renvoie l'objet public si OK, sinon null.
export async function authenticate(email, plainPassword) {
  const u = await findByEmail(email);
  if (!u) {
    // Comparaison "à vide" pour limiter la fuite de timing (existence d'email)
    verifyPassword(plainPassword, 'scrypt$00$00');
    return null;
  }
  if (!verifyPassword(plainPassword, u.password_hash)) return null;
  return publicUser(u);
}

// ---------------------------------------------------------------------------
// Operations administrateur (v2.16)
// ---------------------------------------------------------------------------

/**
 * Liste publique de TOUS les utilisateurs (admin uniquement, c'est a l'appelant
 * de verifier). Champ `last_active_at` reste null ici : c'est calcule par le
 * server.js a partir des conversations.
 */
export async function listAllUsers() {
  const db = await ensureLoaded();
  return db.users.map((u) => ({
    id: u.id,
    email: u.email,
    is_admin: !!u.is_admin,
    is_disabled: !!u.is_disabled,
    has_key: !!u.openrouter_key_enc,
    created_at: u.created_at,
  }));
}

/** Active / desactive un compte. */
export async function setActive(userId, active) {
  return updateAndSave(userId, (user) => { user.is_disabled = !active; });
}

/** Promeut / retrograde admin. */
export async function setAdmin(userId, isAdmin) {
  return updateAndSave(userId, (user) => { user.is_admin = !!isAdmin; });
}

/**
 * Reset du mot de passe par un admin : pas de verification du mot de passe
 * actuel (c'est tout l'interet : l'utilisateur l'a oublie).
 * Renvoie un mot de passe temporaire genere si `newPassword` est omis,
 * sinon utilise celui fourni.
 */
export async function adminResetPassword(userId, newPassword = null) {
  const pwd = newPassword || generateTempPassword();
  await updateAndSave(userId, (user) => {
    user.password_hash = hashPassword(pwd);
  });
  return { temp_password: pwd };
}

/**
 * Suppression d'un compte par un admin : pas de verification du mot de passe.
 * Reservee aux routes admin (le check d'admin est cote server.js).
 */
export async function adminDelete(userId) {
  const db = await ensureLoaded();
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx === -1) { const e = new Error('Compte introuvable.'); e.code = 'NOT_FOUND'; throw e; }
  db.users.splice(idx, 1);
  await persist();
  return { id: userId };
}

function generateTempPassword() {
  // 12 caracteres URL-safe, lisibles
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export { publicUser };

// ---------------------------------------------------------------------------
// Modifications du compte (v2.14)
// ---------------------------------------------------------------------------

async function updateAndSave(userId, mutator) {
  const db = await ensureLoaded();
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx === -1) {
    const e = new Error('Compte introuvable.');
    e.code = 'NOT_FOUND';
    throw e;
  }
  mutator(db.users[idx]);
  await persist();
  return publicUser(db.users[idx]);
}

/**
 * Change le mot de passe (apres verification du mot de passe actuel).
 */
export async function updatePassword(userId, currentPassword, newPassword) {
  const db = await ensureLoaded();
  const u = db.users.find((x) => x.id === userId);
  if (!u) { const e = new Error('Compte introuvable.'); e.code = 'NOT_FOUND'; throw e; }
  if (!verifyPassword(currentPassword, u.password_hash)) {
    const e = new Error('Mot de passe actuel incorrect.');
    e.code = 'BAD_CURRENT_PASSWORD';
    throw e;
  }
  return updateAndSave(userId, (user) => {
    user.password_hash = hashPassword(newPassword);
  });
}

/**
 * Change l'email (apres verification du mot de passe actuel).
 * Verifie aussi l'unicite de l'email cible.
 */
export async function updateEmail(userId, newEmail, currentPassword) {
  const db = await ensureLoaded();
  const u = db.users.find((x) => x.id === userId);
  if (!u) { const e = new Error('Compte introuvable.'); e.code = 'NOT_FOUND'; throw e; }
  if (!verifyPassword(currentPassword, u.password_hash)) {
    const e = new Error('Mot de passe actuel incorrect.');
    e.code = 'BAD_CURRENT_PASSWORD';
    throw e;
  }
  const cleanEmail = String(newEmail || '').trim();
  const lower = cleanEmail.toLowerCase();
  if (lower === u.email_lower) {
    // pas un changement, mais pas une erreur non plus -> renvoie tel quel
    return publicUser(u);
  }
  if (db.users.some((x) => x.id !== userId && x.email_lower === lower)) {
    const e = new Error('Un autre compte utilise déjà cet email.');
    e.code = 'EMAIL_TAKEN';
    throw e;
  }
  return updateAndSave(userId, (user) => {
    user.email = cleanEmail;
    user.email_lower = lower;
  });
}

/**
 * Supprime un compte (apres verification du mot de passe actuel).
 * Renvoie l'ID supprime ou jette en cas d'erreur.
 * NB: la suppression des conversations associees est faite par l'appelant
 * (server.js) avec storage.listConversations(user) + deleteConversation().
 */
export async function deleteUser(userId, currentPassword) {
  const db = await ensureLoaded();
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx === -1) { const e = new Error('Compte introuvable.'); e.code = 'NOT_FOUND'; throw e; }
  const u = db.users[idx];
  if (!verifyPassword(currentPassword, u.password_hash)) {
    const e = new Error('Mot de passe actuel incorrect.');
    e.code = 'BAD_CURRENT_PASSWORD';
    throw e;
  }
  db.users.splice(idx, 1);
  await persist();
  return { id: userId };
}

// ---------------------------------------------------------------------------
// Cle OpenRouter par utilisateur (v2.15) — stockage chiffre
// ---------------------------------------------------------------------------

import { encryptSecret, decryptSecret } from './crypto.js';

/**
 * Enregistre la cle OpenRouter de l'utilisateur, chiffree.
 * Pas de verification de mot de passe : on est deja derriere la session.
 */
export async function setOpenRouterKey(userId, plainKey) {
  if (typeof plainKey !== 'string' || plainKey.trim().length < 10) {
    const e = new Error('Clé invalide (trop courte).');
    e.code = 'BAD_KEY';
    throw e;
  }
  const enc = encryptSecret(plainKey.trim());
  return updateAndSave(userId, (user) => { user.openrouter_key_enc = enc; });
}

/** Supprime la cle de l'utilisateur. */
export async function clearOpenRouterKey(userId) {
  return updateAndSave(userId, (user) => { user.openrouter_key_enc = null; });
}

/**
 * Renvoie la cle DECHIFFREE de l'utilisateur, ou null s'il n'en a pas.
 * Reservee aux appels SERVEUR (n'expose JAMAIS au navigateur).
 */
export async function getDecryptedKey(userId) {
  const u = await findById(userId);
  if (!u || !u.openrouter_key_enc) return null;
  return decryptSecret(u.openrouter_key_enc);
}
