import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useConfirm } from './ConfirmDialog.jsx';

// Format date+heure precis : "28/05/2026 19:13" (heure locale).
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
};
const fmtCost = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n < 0.0001) return '$0';
  return `$${n.toFixed(4)}`;
};

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      flex: '1 1 150px', minWidth: 140,
      background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #eceef1)',
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  );
}

const tdStyle = { padding: '10px 12px', borderBottom: '1px solid var(--border, #eceef1)', fontSize: 13, verticalAlign: 'middle' };
const thStyle = { ...tdStyle, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-card, #fafbfc)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 2 };

function Badge({ children, color = 'gray' }) {
  const palette = {
    green:  { bg: '#e7f5ec', fg: '#1f7a3a', bd: '#cfe9d6' },
    orange: { bg: '#fff5e6', fg: '#a06010', bd: '#f3e0c2' },
    red:    { bg: '#fbeaea', fg: '#b04040', bd: '#f0c2c2' },
    blue:   { bg: '#eef3ff', fg: '#3f63ad', bd: '#cfd9f3' },
    gray:   { bg: '#eef0f3', fg: '#5b6470', bd: '#dde1e7' },
  }[color];
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 999,
      background: palette.bg, color: palette.fg, border: `1px solid ${palette.bd}`,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

const btn = {
  padding: '5px 10px', fontSize: 12, fontWeight: 600,
  borderRadius: 6, cursor: 'pointer', border: '1px solid transparent',
  whiteSpace: 'nowrap', background: 'var(--bg-main, #fff)', color: 'var(--text-primary)',
};

export default function AdminPage({ onClose, currentUserId }) {
  const [data, setData] = useState(null); // { totals, users }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [resetInfo, setResetInfo] = useState(null); // { email, temp_password } -> modale propre
  const [tempCopied, setTempCopied] = useState(false);
  const [toast, setToast] = useState(null); // { kind, message }
  const confirm = useConfirm();

  function showError(message) {
    setToast({ kind: 'err', message });
    setTimeout(() => setToast(null), 3500);
  }

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.adminListUsers();
      setData(d);
    } catch (err) {
      setError(err?.message?.includes('403')
        ? 'Accès refusé : ton compte n\'est pas administrateur.'
        : 'Impossible de charger les utilisateurs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.users;
    return data.users.filter((u) => (u.email || '').toLowerCase().includes(q));
  }, [data, search]);

  async function toggleActive(u) {
    if (u.is_self) return;
    setBusyId(u.id);
    try {
      await api.adminSetActive(u.id, u.is_disabled);
      await reload();
    } catch {
      showError('Impossible de modifier le statut.');
    } finally { setBusyId(null); }
  }
  async function toggleAdmin(u) {
    if (u.is_self) return;
    const ok = await confirm({
      title: u.is_admin ? 'Retirer le rôle administrateur ?' : 'Promouvoir administrateur ?',
      message: u.is_admin
        ? `${u.email} perdra l'accès au panneau Admin.`
        : `${u.email} aura accès au panneau Admin et pourra gérer les autres comptes.`,
      confirmLabel: u.is_admin ? 'Rétrograder' : 'Promouvoir',
      danger: u.is_admin,
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await api.adminSetAdmin(u.id, !u.is_admin);
      await reload();
    } catch {
      showError('Impossible de modifier le rôle.');
    } finally { setBusyId(null); }
  }
  async function resetPassword(u) {
    if (u.is_self) return;
    const ok = await confirm({
      title: 'Réinitialiser le mot de passe ?',
      message: `Un mot de passe temporaire sera affiché pour ${u.email}. Note-le pour le lui transmettre — il ne sera plus affiché ensuite.`,
      confirmLabel: 'Réinitialiser',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      const res = await api.adminResetPassword(u.id);
      setResetInfo({ temp_password: res.temp_password, email: res.email || u.email });
      setTempCopied(false);
    } catch {
      showError('Impossible de réinitialiser le mot de passe.');
    } finally { setBusyId(null); }
  }
  async function removeUser(u) {
    if (u.is_self) return;
    const ok = await confirm({
      title: `Supprimer ${u.email} ?`,
      message: 'Le compte ET toutes ses conversations seront définitivement effacés. Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await api.adminDeleteUser(u.id);
      await reload();
    } catch {
      showError('Impossible de supprimer.');
    } finally { setBusyId(null); }
  }

  function copyTempPassword() {
    if (!resetInfo) return;
    navigator.clipboard?.writeText(resetInfo.temp_password);
    setTempCopied(true);
    setTimeout(() => setTempCopied(false), 1600);
  }

  return (
    <div className="main">
      <div className="main-header" style={{ justifyContent: 'space-between' }}>
        <div className="main-header-title">🛡️ Administration</div>
        {onClose && <button className="export-btn" onClick={onClose} title="Revenir">← Retour</button>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {toast && (
          <div style={{
            marginBottom: 14, padding: '10px 14px',
            background: toast.kind === 'err' ? '#fbeaea' : '#e7f5ec',
            color: toast.kind === 'err' ? '#b04040' : '#1f7a3a',
            border: `1px solid ${toast.kind === 'err' ? '#f0c2c2' : '#cfe9d6'}`,
            borderRadius: 8, fontSize: 13, fontWeight: 500,
            animation: 'rm-pop .14s ease-out',
          }}>{toast.message}</div>
        )}
        {loading && <div style={{ padding: 20, color: 'var(--text-secondary)' }}>Chargement…</div>}
        {error && <div style={{ padding: 12, background: '#fbeaea', color: '#b04040', border: '1px solid #f0c2c2', borderRadius: 8 }}>{error}</div>}

        {data && (
          <>
            {/* Stats globales */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
              <StatCard label="Utilisateurs" value={data.totals.users_count} sub={`${data.totals.active_users} actif${data.totals.active_users > 1 ? 's' : ''}`} />
              <StatCard label="Admins" value={data.totals.admins_count} />
              <StatCard label="Avec clé OpenRouter" value={data.totals.users_with_key} />
              <StatCard label="Conversations" value={data.totals.total_conversations} />
              <StatCard label="Coût cumulé" value={fmtCost(data.totals.total_cost_usd)} />
            </div>

            {/* Recherche */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer par email…"
              style={{
                width: '100%', maxWidth: 360, padding: '8px 10px', fontSize: 13,
                border: '1px solid var(--border-2, #d9dee5)', borderRadius: 8,
                background: 'var(--bg-main, #fff)', color: 'var(--text-primary)',
                marginBottom: 14,
              }}
            />

            {/* Tableau */}
            <div style={{ overflowX: 'auto', border: '1px solid var(--border, #eceef1)', borderRadius: 10, background: 'var(--bg-card, #fff)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Rôle</th>
                    <th style={thStyle}>État</th>
                    <th style={thStyle}>Clé</th>
                    <th style={thStyle}>Créé</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Conv.</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Coût</th>
                    <th style={thStyle}>Dernière activité</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} style={{ opacity: u.is_disabled ? 0.6 : 1 }}>
                      <td style={tdStyle}>
                        <strong>{u.email}</strong>
                        {u.is_self && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-secondary)' }}>(toi)</span>}
                      </td>
                      <td style={tdStyle}>{u.is_admin ? <Badge color="blue">Admin</Badge> : <Badge>Utilisateur</Badge>}</td>
                      <td style={tdStyle}>{u.is_disabled ? <Badge color="red">Désactivé</Badge> : <Badge color="green">Actif</Badge>}</td>
                      <td style={tdStyle}>{u.has_key ? <Badge color="green">✓</Badge> : <Badge color="orange">—</Badge>}</td>
                      <td style={tdStyle}>{fmtDateTime(u.created_at)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{u.conv_count}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtCost(u.total_cost_usd)}</td>
                      <td style={tdStyle}>{fmtDateTime(u.last_active_at)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {u.is_self ? (
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>—</span>
                        ) : (
                          <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button
                              style={{ ...btn, border: '1px solid var(--border-2, #d9dee5)' }}
                              disabled={busyId === u.id}
                              onClick={() => resetPassword(u)}
                              title="Réinitialiser le mot de passe"
                            >🔑 Reset mdp</button>
                            <button
                              style={{ ...btn, border: '1px solid var(--border-2, #d9dee5)' }}
                              disabled={busyId === u.id}
                              onClick={() => toggleActive(u)}
                              title={u.is_disabled ? 'Réactiver' : 'Désactiver'}
                            >{u.is_disabled ? '▶ Réactiver' : '⏸ Désactiver'}</button>
                            <button
                              style={{ ...btn, border: '1px solid var(--border-2, #d9dee5)' }}
                              disabled={busyId === u.id}
                              onClick={() => toggleAdmin(u)}
                              title={u.is_admin ? 'Retirer admin' : 'Promouvoir admin'}
                            >{u.is_admin ? '👤 Rétrograder' : '👑 Promouvoir'}</button>
                            <button
                              style={{ ...btn, color: '#b04040', border: '1px solid #f0c2c2' }}
                              disabled={busyId === u.id}
                              onClick={() => removeUser(u)}
                              title="Supprimer définitivement"
                            >🗑️ Supprimer</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td style={tdStyle} colSpan={9}><em>Aucun utilisateur ne correspond.</em></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modale propre du mot de passe temporaire (meme look que ConfirmDialog) */}
      {resetInfo && (
        <div
          onClick={() => setResetInfo(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(15, 20, 35, 0.45)',
            backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            animation: 'rm-fade .12s ease-out',
          }}
        >
          <style>{`
            @keyframes rm-fade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes rm-pop  { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          `}</style>
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{
              width: '100%', maxWidth: 480,
              background: 'var(--bg-card, #fff)',
              borderRadius: 14,
              border: '1px solid var(--border, #eceef1)',
              boxShadow: '0 24px 64px rgba(15,20,35,0.18), 0 6px 16px rgba(15,20,35,0.08)',
              padding: '22px 24px 18px',
              animation: 'rm-pop .14s ease-out',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              🔑 Mot de passe temporaire
            </h3>
            <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              Note-le et transmets-le à <strong style={{ color: 'var(--text-primary)' }}>{resetInfo.email}</strong>. Il pourra le changer dans « Mon compte » après connexion.
              Ce mot de passe ne sera <strong>plus jamais affiché</strong>.
            </div>
            <div style={{
              marginTop: 14,
              fontFamily: 'ui-monospace, SF Mono, Menlo, monospace', fontSize: 18, fontWeight: 600,
              padding: '14px 16px',
              background: '#fff5e6',
              border: '1px solid #f3e0c2',
              borderRadius: 10,
              textAlign: 'center', letterSpacing: 1.5,
              color: '#7a4a10',
            }}>{resetInfo.temp_password}</div>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={copyTempPassword}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 600,
                  background: tempCopied ? '#e7f5ec' : 'transparent',
                  color: tempCopied ? '#1f7a3a' : 'var(--text-secondary)',
                  border: `1px solid ${tempCopied ? '#cfe9d6' : 'var(--border-2, #d9dee5)'}`,
                  borderRadius: 8, cursor: 'pointer', transition: 'all .15s',
                }}
              >
                {tempCopied ? '✓ Copié' : '📋 Copier'}
              </button>
              <button
                type="button"
                onClick={() => setResetInfo(null)}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  background: 'var(--accent, #5d83d4)', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
