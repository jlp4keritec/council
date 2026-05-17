import { useState, useCallback, useEffect } from 'react';
import { api } from './api.js';
import { loadConfigOverride, saveConfigOverride } from './utils.js';
import Sidebar from './components/Sidebar.jsx';
import ChatInterface from './components/ChatInterface.jsx';
import ModelSelector from './components/ModelSelector.jsx';
import QuotaHelp from './components/QuotaHelp.jsx';

export default function App() {
  const [activeId, setActiveId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [showQuotaHelp, setShowQuotaHelp] = useState(false);
  const [override, setOverride] = useState(loadConfigOverride);
  const [serverDefaults, setServerDefaults] = useState(null);

  useEffect(() => {
    api.getConfig().then(setServerDefaults).catch(console.error);
  }, []);

  // Listener pour les events custom emis par les composants enfants
  // (ex: FatalErrorBlock declenche 'open-quota-help' quand quota epuise)
  useEffect(() => {
    const openHelp = () => setShowQuotaHelp(true);
    window.addEventListener('open-quota-help', openHelp);
    return () => window.removeEventListener('open-quota-help', openHelp);
  }, []);

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
    </div>
  );
}
