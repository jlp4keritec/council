import { useState } from 'react';
import { api } from '../api.js';
import './Login.css';

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.authLogin(username.trim(), password);
      if (res?.authenticated) {
        onLoginSuccess?.();
      } else {
        setError('Reponse inattendue du serveur');
      }
    } catch (err) {
      // 401 ou autre
      const msg = err?.message || '';
      if (msg.includes('401')) {
        setError('Identifiants incorrects');
      } else if (msg === 'UNAUTHORIZED') {
        setError('Identifiants incorrects');
      } else {
        setError('Erreur de connexion. Vérifiez que le backend tourne.');
      }
    } finally {
      setLoading(false);
    }
  }

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

        <h1 className="login-title">Connexion</h1>
        <p className="login-subtitle">
          Accès réservé. Utilisez vos identifiants administrateur.
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-field">
            <span className="login-label">Identifiant</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
              autoFocus
            />
          </label>

          <label className="login-field">
            <span className="login-label">Mot de passe</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loading || !username || !password} className="login-submit">
            {loading ? (
              <><span className="login-spinner"></span> Connexion...</>
            ) : (
              'Se connecter'
            )}
          </button>
        </form>

        <div className="login-footer">
          <a href="/">← Retour à l'accueil</a>
        </div>
      </div>
    </div>
  );
}
