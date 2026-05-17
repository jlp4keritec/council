// Helpers utilitaires partages entre composants.

const STORAGE_KEY = 'llm-council-config-override';

export function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '–';
  const seconds = ms / 1000;
  if (seconds < 1) return `${ms} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}m${sec.toString().padStart(2, '0')}`;
}

export function loadConfigOverride() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveConfigOverride(config) {
  try {
    if (config == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  } catch (e) {
    console.warn('localStorage indisponible:', e);
  }
}

export function shortModelName(modelId) {
  if (!modelId) return '?';
  // Garde le suffixe :free si present, sinon juste la derniere partie
  const parts = modelId.split('/');
  return parts[parts.length - 1];
}

/**
 * Format ISO date -> "16 mai 2026 a 14:32" pour tooltip
 */
export function formatDateTooltip(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${date} à ${time}`;
  } catch {
    return isoString;
  }
}
