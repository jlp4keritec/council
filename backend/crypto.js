// backend/crypto.js — chiffrement symetrique pour secrets utilisateur
//
// Algo : AES-256-GCM (chiffre + authentifie, sans dependance externe).
// Cle maitre : derivee d'OPENROUTER_KEYS_SECRET via scrypt -> 32 octets.
//
// Format stocke : "v1.<iv_b64>.<tag_b64>.<ct_b64>"
//   v1     : version du format (futur-proof)
//   iv     : 12 octets aleatoires (nonce GCM)
//   tag    : 16 octets, garantit qu'on detecte un fichier modifie
//   ct     : ciphertext (longueur = longueur du clair)
//
// Securite :
//  - Sans le secret, impossible de lire les cles (meme en ouvrant users.json).
//  - Modification d'un caractere -> dechiffrement echoue (integrite verifiee).
//  - Nouveau IV a chaque chiffrement (jamais reutilise un nonce, regle GCM).

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { OPENROUTER_KEYS_SECRET, SESSION_SECRET } from './config.js';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SCRYPT_SALT = 'llm-council-keys-v1'; // sel "applicatif" stable

let _masterKey = null;

function getMasterKey() {
  if (_masterKey) return _masterKey;
  // Priorite : OPENROUTER_KEYS_SECRET. A defaut, SESSION_SECRET (qui herite
  // d'OPENROUTER_API_KEY si rien n'est defini). Avertissement si tout est vide.
  const secret = OPENROUTER_KEYS_SECRET || SESSION_SECRET;
  if (!secret || secret.length < 8) {
    throw new Error(
      'Impossible de chiffrer les clés OpenRouter : OPENROUTER_KEYS_SECRET ' +
      '(ou SESSION_SECRET) doit être défini dans le .env (≥ 8 caractères).'
    );
  }
  _masterKey = scryptSync(secret, SCRYPT_SALT, KEY_LEN);
  return _masterKey;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Chiffre une chaine en clair. Renvoie un token serialise (string).
 */
export function encryptSecret(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('encryptSecret: clair vide');
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(tag)}.${b64url(ct)}`;
}

/**
 * Dechiffre un token. Renvoie la chaine claire, ou null si invalide / corrompu.
 */
export function decryptSecret(token) {
  if (typeof token !== 'string' || !token.startsWith('v1.')) return null;
  try {
    const [, ivB64, tagB64, ctB64] = token.split('.');
    const iv = b64urlDecode(ivB64);
    const tag = b64urlDecode(tagB64);
    const ct = b64urlDecode(ctB64);
    const key = getMasterKey();
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf-8');
  } catch {
    return null;
  }
}
