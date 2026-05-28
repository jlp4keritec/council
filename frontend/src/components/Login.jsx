import { useState } from 'react';
import { api } from '../api.js';
import './Login.css';

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isSignup = mode === 'signup';

  function switchMode(next) {
    setMode(next);
    setError(null);
    setPassword2('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (isSignup && password !== password2) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (isSignup && password.length < 8) {
      setError('Mot de passe trop court (au moins 8 caractères).');
      return;
    }

    setLoading(true);
    try {
      const res = isSignup
        ? await api.authSignup(email.trim(), password)
        : await api.authLogin(email.trim(), password);

      if (res?.authenticated) {
        onLoginSuccess?.();
      } else {
        setError('Réponse inattendue du serveur.');
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('409') || msg.includes('email_taken')) {
        setError('Un compte existe déjà avec cet email.');
      } else if (msg.includes('400') && isSignup) {
        setError('Email invalide ou mot de passe trop court.');
      } else if (msg.includes('401') || msg === 'UNAUTHORIZED') {
        setError('Email ou mot de passe incorrect.');
      } else if (msg.includes('429')) {
        setError('Trop de tentatives. Réessaie dans quelques minutes.');
      } else {
        setError('Erreur de connexion. Vérifie que le serveur tourne.');
      }
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = email && password && (!isSignup || password2);

  return (
    <div className="login-page">
      <div className="login-bg-orbs">
        <div className="login-orb login-orb-1"></div>
        <div className="login-orb login-orb-2"></div>
      </div>

      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">LC</div>
          <div className="login-brand-name">LLM Council</div>
        </div>

        {/* Onglets Connexion / Inscription */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 18, background: 'rgba(0,0,0,0.04)', borderRadius: 10, padding: 4 }}>
          {[['login', 'Connexion'], ['signup', 'Créer un compte']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => switchMode(key)}
              disabled={loading}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: mode === key ? 'var(--accent, #5d83d4)' : 'transparent',
                color: mode === key ? '#fff' : 'var(--text-secondary, #6c757d)',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <h1 className="login-title">{isSignup ? 'Créer un compte' : 'Connexion'}</h1>
        <p className="login-subtitle">
          {isSignup
            ? 'Inscris-toi avec ton email. Tu brancheras ta clé OpenRouter juste après.'
            : 'Connecte-toi avec ton email et ton mot de passe.'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-field">
            <span className="login-label">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              autoFocus
            />
          </label>

          <label className="login-field">
            <span className="login-label">Mot de passe</span>
            <input
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </label>

          {isSignup && (
            <label className="login-field">
              <span className="login-label">Confirmer le mot de passe</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={loading}
                required
              />
            </label>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loading || !canSubmit} className="login-submit">
            {loading ? (
              <><span className="login-spinner"></span> {isSignup ? 'Création...' : 'Connexion...'}</>
            ) : (
              isSignup ? 'Créer mon compte' : 'Se connecter'
            )}
          </button>
        </form>

        <div className="login-footer">
          {isSignup ? (
            <button type="button" className="login-linkbtn" onClick={() => switchMode('login')}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}>
              Déjà un compte ? Se connecter
            </button>
          ) : (
            <button type="button" className="login-linkbtn" onClick={() => switchMode('signup')}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}>
              Pas encore de compte ? S'inscrire
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
