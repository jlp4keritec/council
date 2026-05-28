import { useState } from 'react';
import { api } from '../api.js';
import { useConfirm } from './ConfirmDialog.jsx';

// Petit composant réutilisable pour une "carte" de réglage
function Section({ title, description, children, danger }) {
  return (
    <section style={{
      background: 'var(--bg-card, #fff)',
      border: `1px solid ${danger ? '#f0c2c2' : 'var(--border, #eceef1)'}`,
      borderRadius: 10,
      padding: '16px 18px',
      marginBottom: 18,
    }}>
      <h3 style={{ margin: 0, fontSize: 15, color: danger ? '#b04040' : 'var(--text-primary)' }}>{title}</h3>
      {description && (
        <p style={{ margin: '6px 0 14px', fontSize: 13, color: 'var(--text-secondary)' }}>{description}</p>
      )}
      {children}
    </section>
  );
}

const fieldStyle = {
  width: '100%', padding: '9px 11px', fontSize: 14,
  border: '1px solid var(--border-2, #d9dee5)', borderRadius: 8,
  outline: 'none', background: 'var(--bg-main, #fff)', color: 'var(--text-primary)',
};
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };
const btnPrimary = {
  padding: '9px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--accent, #5d83d4)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnDanger = { ...btnPrimary, background: '#c4453d' };

function Status({ status }) {
  if (!status) return null;
  const color = status.kind === 'ok' ? '#1f7a3a' : '#b04040';
  const bg    = status.kind === 'ok' ? '#e7f5ec' : '#fbeaea';
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', fontSize: 13, color, background: bg, border: `1px solid ${color}22`, borderRadius: 6 }}>
      {status.message}
    </div>
  );
}

export default function AccountPage({ user, onClose, onLogoutAfterDelete, onEmailChanged, onKeyChanged }) {
  const confirm = useConfirm();
  // ---------- Mot de passe ----------
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwStatus, setPwStatus] = useState(null);

  async function submitPassword(e) {
    e.preventDefault();
    setPwStatus(null);
    if (pwNew.length < 8) { setPwStatus({ kind: 'err', message: 'Nouveau mot de passe trop court (au moins 8 caractères).' }); return; }
    if (pwNew !== pwConfirm) { setPwStatus({ kind: 'err', message: 'Les deux nouveaux mots de passe ne correspondent pas.' }); return; }
    setPwLoading(true);
    try {
      await api.authChangePassword(pwCurrent, pwNew);
      setPwStatus({ kind: 'ok', message: 'Mot de passe changé. ✓' });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('401')) setPwStatus({ kind: 'err', message: 'Mot de passe actuel incorrect.' });
      else if (msg.includes('400')) setPwStatus({ kind: 'err', message: 'Nouveau mot de passe invalide (8 caractères min).' });
      else setPwStatus({ kind: 'err', message: 'Erreur lors du changement de mot de passe.' });
    } finally {
      setPwLoading(false);
    }
  }

  // ---------- Email ----------
  const [emailNew, setEmailNew] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);

  async function submitEmail(e) {
    e.preventDefault();
    setEmailStatus(null);
    setEmailLoading(true);
    try {
      const res = await api.authChangeEmail(emailNew, emailPw);
      setEmailStatus({ kind: 'ok', message: `Email mis à jour : ${res.email} ✓` });
      setEmailNew(''); setEmailPw('');
      onEmailChanged?.(res.email);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('401')) setEmailStatus({ kind: 'err', message: 'Mot de passe actuel incorrect.' });
      else if (msg.includes('409')) setEmailStatus({ kind: 'err', message: 'Un autre compte utilise déjà cet email.' });
      else if (msg.includes('400')) setEmailStatus({ kind: 'err', message: 'Email invalide.' });
      else setEmailStatus({ kind: 'err', message: 'Erreur lors du changement d\'email.' });
    } finally {
      setEmailLoading(false);
    }
  }

  // ---------- Cle OpenRouter ----------
  const [orKey, setOrKey] = useState('');
  const [orLoading, setOrLoading] = useState(false);     // enregistrement
  const [orTesting, setOrTesting] = useState(false);     // test rapide
  const [orStatus, setOrStatus] = useState(null);
  const [hasKey, setHasKey] = useState(!!user?.has_key);

  async function submitKey(e) {
    e.preventDefault();
    setOrStatus(null);
    setOrLoading(true);
    try {
      await api.authSetOpenRouterKey(orKey);
      setOrStatus({ kind: 'ok', message: 'Clé enregistrée (chiffrée). ✓' });
      setOrKey('');
      setHasKey(true);
      onKeyChanged?.(true);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('400')) setOrStatus({ kind: 'err', message: 'Clé invalide (trop courte).' });
      else setOrStatus({ kind: 'err', message: 'Erreur lors de l\'enregistrement.' });
    } finally {
      setOrLoading(false);
    }
  }

  async function testKey() {
    setOrStatus(null);
    setOrTesting(true);
    try {
      // Si l'utilisateur a tape une cle dans le champ, on teste celle-ci.
      // Sinon, on teste la cle deja enregistree (s'il en a une).
      const res = await api.authTestOpenRouterKey(orKey.trim() || null);
      if (res.ok) {
        let extra = '';
        if (res.details) {
          if (res.details.label) extra += ` · ${res.details.label}`;
          if (typeof res.details.usage === 'number') extra += ` · usage ${res.details.usage}`;
          if (typeof res.details.limit === 'number') extra += ` / limite ${res.details.limit}`;
          if (res.details.is_free_tier === true) extra += ' · free tier';
        }
        setOrStatus({ kind: 'ok', message: `Clé valide ✓${extra}` });
      } else {
        setOrStatus({ kind: 'err', message: res.message || 'Clé invalide.' });
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('400')) setOrStatus({ kind: 'err', message: 'Aucune clé à tester. Colle ta clé et réessaie.' });
      else setOrStatus({ kind: 'err', message: 'Impossible de joindre OpenRouter.' });
    } finally {
      setOrTesting(false);
    }
  }

  async function clearKey() {
    const ok = await confirm({
      title: 'Supprimer ta clé OpenRouter ?',
      message: 'Tu ne pourras plus lancer de délibération tant que tu n\'en enregistres pas une nouvelle.',
      confirmLabel: 'Supprimer la clé',
      danger: true,
    });
    if (!ok) return;
    setOrStatus(null);
    try {
      await api.authClearOpenRouterKey();
      setHasKey(false);
      setOrKey('');
      setOrStatus({ kind: 'ok', message: 'Clé supprimée. ✓' });
      onKeyChanged?.(false);
    } catch {
      setOrStatus({ kind: 'err', message: 'Erreur lors de la suppression.' });
    }
  }

  // ---------- Suppression ----------
  const [delPw, setDelPw] = useState('');
  const [delConfirm, setDelConfirm] = useState('');
  const [delLoading, setDelLoading] = useState(false);
  const [delStatus, setDelStatus] = useState(null);

  async function submitDelete(e) {
    e.preventDefault();
    setDelStatus(null);
    if (delConfirm !== 'SUPPRIMER') { setDelStatus({ kind: 'err', message: 'Tape exactement SUPPRIMER pour confirmer.' }); return; }
    const ok = await confirm({
      title: 'Supprimer définitivement ton compte ?',
      message: 'Toutes tes conversations et ta clé OpenRouter seront effacées. Cette action est irréversible.',
      confirmLabel: 'Oui, supprimer mon compte',
      danger: true,
    });
    if (!ok) return;
    setDelLoading(true);
    try {
      const res = await api.authDeleteAccount(delPw);
      await confirm({
        title: 'Compte supprimé',
        message: `${res.deleted_conversations} conversation${res.deleted_conversations > 1 ? 's ont été supprimées' : ' a été supprimée'} avec ton compte.`,
        confirmLabel: 'OK',
        cancelLabel: 'OK',
      });
      onLogoutAfterDelete?.();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('401')) setDelStatus({ kind: 'err', message: 'Mot de passe actuel incorrect.' });
      else setDelStatus({ kind: 'err', message: 'Erreur lors de la suppression du compte.' });
      setDelLoading(false);
    }
  }

  return (
    <div className="main">
      <div className="main-header" style={{ justifyContent: 'space-between' }}>
        <div className="main-header-title">👤 Mon compte</div>
        {onClose && (
          <button className="export-btn" onClick={onClose} title="Revenir">← Retour</button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ maxWidth: 760, width: '100%', margin: '0 auto' }}>

        {/* ---- Infos compte ---- */}
        <Section title="Informations" description="Détails de ton compte.">
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            <div><strong>Email :</strong> {user?.email || '—'}</div>
            <div><strong>Rôle :</strong> {user?.is_admin ? 'Administrateur' : 'Utilisateur'}</div>
            {user?.created_at && (
              <div><strong>Compte créé :</strong> {new Date(user.created_at).toLocaleDateString('fr-FR')}</div>
            )}
          </div>
        </Section>

        {/* ---- Mot de passe ---- */}
        <Section title="Changer le mot de passe" description="Pour ta sécurité, tape d'abord ton mot de passe actuel.">
          <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Mot de passe actuel</label>
              <input type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} required style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Nouveau mot de passe (8 caractères min.)</label>
              <input type="password" autoComplete="new-password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} required minLength={8} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Confirmer le nouveau mot de passe</label>
              <input type="password" autoComplete="new-password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} required style={fieldStyle} />
            </div>
            <div>
              <button type="submit" disabled={pwLoading || !pwCurrent || !pwNew || !pwConfirm} style={{ ...btnPrimary, opacity: pwLoading ? 0.7 : 1 }}>
                {pwLoading ? 'Changement…' : 'Changer le mot de passe'}
              </button>
            </div>
            <Status status={pwStatus} />
          </form>
        </Section>

        {/* ---- Email ---- */}
        <Section title="Changer l'email" description="On te demande ton mot de passe actuel pour confirmer.">
          <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Nouvel email</label>
              <input type="email" autoComplete="off" value={emailNew} onChange={(e) => setEmailNew(e.target.value)} required style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Mot de passe actuel</label>
              <input type="password" autoComplete="current-password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} required style={fieldStyle} />
            </div>
            <div>
              <button type="submit" disabled={emailLoading || !emailNew || !emailPw} style={{ ...btnPrimary, opacity: emailLoading ? 0.7 : 1 }}>
                {emailLoading ? 'Changement…' : 'Changer l\'email'}
              </button>
            </div>
            <Status status={emailStatus} />
          </form>
        </Section>

        {/* ---- Cle OpenRouter ---- */}
        <Section
          title="🔑 Ma clé OpenRouter"
          description={
            hasKey
              ? 'Une clé est enregistrée (chiffrée). Tu peux la remplacer ou la supprimer.'
              : 'Sans clé, tu ne pourras pas lancer de délibération. Colle ta clé ci-dessous (commence par sk-or-…), puis « Tester » pour vérifier qu\'elle marche.'
          }
        >
          <form onSubmit={submitKey} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>
                {hasKey ? 'Nouvelle clé (remplace l\'actuelle)' : 'Clé OpenRouter'}
              </label>
              <input
                type="password"
                autoComplete="off"
                value={orKey}
                onChange={(e) => setOrKey(e.target.value)}
                placeholder="sk-or-v1-…"
                style={fieldStyle}
                spellCheck={false}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                Crée ou récupère ta clé sur <strong>openrouter.ai/keys</strong>. Elle est stockée chiffrée côté serveur.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="submit" disabled={orLoading || !orKey} style={{ ...btnPrimary, opacity: orLoading ? 0.7 : 1 }}>
                {orLoading ? 'Enregistrement…' : (hasKey ? 'Remplacer la clé' : 'Enregistrer la clé')}
              </button>
              <button
                type="button"
                onClick={testKey}
                disabled={orTesting || (!orKey && !hasKey)}
                title={!orKey && !hasKey ? 'Colle d\'abord une clé' : 'Faire un appel test à OpenRouter'}
                style={{
                  padding: '9px 16px', fontSize: 13, fontWeight: 600,
                  background: 'var(--bg-main, #fff)', color: 'var(--accent, #5d83d4)',
                  border: '1px solid var(--accent, #5d83d4)', borderRadius: 8, cursor: 'pointer',
                  opacity: orTesting || (!orKey && !hasKey) ? 0.6 : 1,
                }}
              >
                {orTesting ? '… test' : '🔎 Tester ma clé'}
              </button>
              {hasKey && (
                <button
                  type="button"
                  onClick={clearKey}
                  style={{
                    padding: '9px 14px', fontSize: 13, fontWeight: 600,
                    background: 'transparent', color: '#b04040',
                    border: '1px solid #f0c2c2', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  Supprimer la clé
                </button>
              )}
              <span style={{
                marginLeft: 'auto', fontSize: 12, fontWeight: 600,
                padding: '4px 10px', borderRadius: 999,
                background: hasKey ? '#e7f5ec' : '#fff5e6',
                color: hasKey ? '#1f7a3a' : '#a06010',
                border: `1px solid ${hasKey ? '#cfe9d6' : '#f3e0c2'}`,
              }}>
                {hasKey ? '✓ Clé enregistrée' : '⚠ Aucune clé'}
              </span>
            </div>
            <Status status={orStatus} />
          </form>
        </Section>

        {/* ---- Suppression ---- */}
        <Section
          title="⚠️ Supprimer le compte"
          description="Cette action est définitive. Toutes tes conversations seront effacées."
          danger
        >
          <form onSubmit={submitDelete} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Mot de passe actuel</label>
              <input type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} required style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Tape <code>SUPPRIMER</code> pour confirmer</label>
              <input type="text" value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} required style={fieldStyle} placeholder="SUPPRIMER" />
            </div>
            <div>
              <button type="submit" disabled={delLoading || !delPw || delConfirm !== 'SUPPRIMER'} style={{ ...btnDanger, opacity: delLoading ? 0.7 : 1 }}>
                {delLoading ? 'Suppression…' : 'Supprimer définitivement mon compte'}
              </button>
            </div>
            <Status status={delStatus} />
          </form>
        </Section>

        </div>
      </div>
    </div>
  );
}
