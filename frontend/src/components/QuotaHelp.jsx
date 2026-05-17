import { useEffect } from 'react';

export default function QuotaHelp({ isOpen, onClose }) {
  // Fermeture sur Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Quota OpenRouter — comment continuer</h2>
          <button className="modal-close" onClick={onClose} title="Fermer">×</button>
        </div>

        <div className="modal-body">
          <div className="quota-intro">
            Le palier OpenRouter par défaut (sans dépôt) est de <strong>50 requêtes par jour</strong> sur les modèles <code>:free</code>.
            Comme un pipeline Council consomme ~10 appels, ça plafonne à <strong>~5 questions/jour</strong>.
            Voici tes options pour aller plus loin.
          </div>

          {/* Option A */}
          <div className="quota-option quota-option-recommended">
            <div className="quota-option-header">
              <span className="quota-option-letter">A</span>
              <span className="quota-option-title">Déposer 10$ sur OpenRouter</span>
              <span className="quota-option-badge">★ Recommandé</span>
            </div>
            <ul>
              <li>1 clic sur <a href="https://openrouter.ai/credits" target="_blank" rel="noopener noreferrer">openrouter.ai/credits</a>, dépose 10$ via Stripe</li>
              <li>Tu passes immédiatement à <strong>1000 req/jour</strong> pour les <code>:free</code>, soit ~100 questions/jour</li>
              <li><strong>Le crédit n'est pas consommé</strong> tant que tu utilises uniquement des modèles <code>:free</code> — il reste sur ton compte</li>
              <li>Si un jour tu appelles un modèle payant, il sera décompté de ce crédit (jusqu'à épuisement)</li>
              <li>C'est ce que recommande explicitement le message d'erreur d'OpenRouter</li>
            </ul>
            <div className="quota-option-action">
              <a
                href="https://openrouter.ai/credits"
                target="_blank"
                rel="noopener noreferrer"
                className="quota-option-button"
              >
                Aller sur openrouter.ai/credits →
              </a>
              <span className="quota-option-cost">Coût réel : 0€ (le crédit reste sur ton compte)</span>
            </div>
          </div>

          {/* Option B */}
          <div className="quota-option">
            <div className="quota-option-header">
              <span className="quota-option-letter">B</span>
              <span className="quota-option-title">Attendre le reset quotidien</span>
              <span className="quota-option-badge quota-option-badge-neutral">Patience</span>
            </div>
            <ul>
              <li>Le quota OpenRouter free se réinitialise <strong>chaque jour à 00:00 UTC</strong></li>
              <li>En heure française, ça correspond à <strong>01:00-02:00</strong> du matin (selon DST)</li>
              <li>Tu retrouves tes 50 requêtes / ~5 questions le lendemain</li>
              <li>Solution gratuite, mais tu perds une journée de productivité</li>
            </ul>
          </div>

          {/* Option C */}
          <div className="quota-option">
            <div className="quota-option-header">
              <span className="quota-option-letter">C</span>
              <span className="quota-option-title">Mixer modèles free + payants bon marché</span>
              <span className="quota-option-badge quota-option-badge-info">Avancé</span>
            </div>
            <ul>
              <li>Garde 2-3 modèles <code>:free</code> + ajoute 1-2 modèles payants bon marché dans ton Council via la modal ⚙ Configuration</li>
              <li>Les modèles payants <strong>ne sont pas soumis au quota free-per-day</strong></li>
              <li>Modèles payants recommandés (low-cost) :
                <ul>
                  <li><code>google/gemini-2.5-flash</code> — environ 0,075 $/M tokens output</li>
                  <li><code>anthropic/claude-haiku-4.5</code> — rapide et fiable</li>
                  <li><code>openai/gpt-5-nano</code> — si tu veux du GPT bon marché</li>
                </ul>
              </li>
              <li>Coût indicatif : <strong>~0,001 $ par question</strong>, soit <strong>0,10 $ pour 100 questions</strong></li>
              <li>Tu n'es plus jamais bloqué par les rate-limits free</li>
            </ul>
          </div>

          <div className="quota-note">
            <strong>Mon conseil :</strong> commence par l'option A (10$ déposés, 0€ de coût réel) qui débloque tout. Si plus tard tu veux des modèles vraiment premium (Opus 4.7, GPT-5.5), tu auras déjà ton crédit prêt.
          </div>
        </div>

        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          <button className="btn-primary" onClick={onClose}>OK, j'ai compris</button>
        </div>
      </div>
    </div>
  );
}
