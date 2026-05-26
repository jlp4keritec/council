import { useState, useCallback, useEffect } from 'react';
import { api } from './api.js';
import { loadConfigOverride, saveConfigOverride } from './utils.js';
import Sidebar from './components/Sidebar.jsx';
import ChatInterface from './components/ChatInterface.jsx';
import ModelSelector from './components/ModelSelector.jsx';
import QuotaHelp from './components/QuotaHelp.jsx';
import About from './components/About.jsx';
import Login from './components/Login.jsx';

export default function App() {
  // ============== AUTH STATE ==============
  // null = en cours de check (boot)
  // false = non authentifie -> affiche Login
  // true = authentifie -> affiche l'app
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authUser, setAuthUser] = useState(null);

  // ============== APP STATE ==============
  const [activeId, setActiveId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [showQuotaHelp, setShowQuotaHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [override, setOverride] = useState(loadConfigOverride);
  const [serverDefaults, setServerDefaults] = useState(null);

  // Check auth au boot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setIsAuthed(!!data.authenticated);
          setAuthUser(data.username || null);
        } else {
          setIsAuthed(false);
        }
      } catch {
        if (!cancelled) setIsAuthed(false);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listener sur l'event 'auth-required' emis par api.js sur 401
  useEffect(() => {
    const onAuthRequired = () => {
      setIsAuthed(false);
      setAuthUser(null);
    };
    window.addEventListener('auth-required', onAuthRequired);
    return () => window.removeEventListener('auth-required', onAuthRequired);
  }, []);

  // Listener pour l'event 'open-quota-help'
  useEffect(() => {
    const openHelp = () => setShowQuotaHelp(true);
    window.addEventListener('open-quota-help', openHelp);
    return () => window.removeEventListener('open-quota-help', openHelp);
  }, []);

  // Listener pour l'event 'open-about'
  useEffect(() => {
    const openAbout = () => setShowAbout(true);
    window.addEventListener('open-about', openAbout);
    return () => window.removeEventListener('open-about', openAbout);
  }, []);

  // Charger la config serveur seulement quand authentifie
  useEffect(() => {
    if (!isAuthed) return;
    api.getConfig().then(setServerDefaults).catch(console.error);
  }, [isAuthed]);

  const handleNew = useCallback(async () => {
    const conv = await api.createConversation();
    setActiveId(conv.id);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleMessageSent = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleApplyConfig = useCallback((newOverride) => {
    setOverride(newOverride);
    saveConfigOverride(newOverride);
  }, []);

  const handleLoginSuccess = useCallback(async () => {
    setIsAuthed(true);
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAuthUser(data.username || null);
      }
    } catch { /* silencieux */ }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.authLogout();
    } catch { /* silencieux */ }
    setIsAuthed(false);
    setAuthUser(null);
    setActiveId(null);
  }, []);

  // ============== RENDER ==============
  // Splash pendant le check initial
  if (!authChecked) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#f8f9fa',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#6c757d', fontSize: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            display: 'inline-block', width: '14px', height: '14px',
            border: '2px solid transparent', borderTopColor: '#4a90e2',
            borderRadius: '50%', animation: 'spin 0.7s linear infinite',
          }}></span>
          <span>Vérification de la session...</span>
        </div>
      </div>
    );
  }

  // Pas authentifie -> Login
  if (!isAuthed) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Authentifie -> App normale
  return (
    <div className="app">
      <Sidebar
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
        onOpenConfig={() => setShowConfig(true)}
        onOpenQuotaHelp={() => setShowQuotaHelp(true)}
        refreshKey={refreshKey}
        hasOverride={!!override}
        authUser={authUser}
        onLogout={handleLogout}
      />
      <ChatInterface
        conversationId={activeId}
        onMessageSent={handleMessageSent}
        override={override}
      />
      <ModelSelector
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        currentOverride={override}
        serverDefaults={serverDefaults}
        onApply={handleApplyConfig}
      />
      <QuotaHelp
        isOpen={showQuotaHelp}
        onClose={() => setShowQuotaHelp(false)}
      />
      <About
        isOpen={showAbout}
        onClose={() => setShowAbout(false)}
      />
    </div>
  );
}
