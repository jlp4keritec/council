import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import { formatDateTooltip } from '../utils.js';

// Surligne la portion [start, end] du texte avec une <mark>.
function Highlight({ text, start, end }) {
  if (start == null || end == null || end <= start || end > text.length) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, start)}
      <mark style={{ background: 'var(--blue-soft, #cfe0ff)', color: 'var(--text-primary)', borderRadius: 3, padding: '0 2px' }}>
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

const EMPTY = { q: '', date_from: '', date_to: '', judge: '', chairman: '' };

const VIEW_KEY = 'council-search-view';
const PAGE_SIZE = 20;

function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; }
  catch { return 'list'; }
}

export default function SearchPage({ onSelect, onClose }) {
  const [criteria, setCriteria] = useState(EMPTY);
  const [facets, setFacets] = useState({ judges: [], chairmen: [] });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [view, setView] = useState(loadView);
  const [page, setPage] = useState(1);
  const inputRef = useRef(null);

  // Memorise la vue choisie
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* silencieux */ }
  }, [view]);

  // Charger les menus (juges / presidents) une fois
  useEffect(() => {
    api.getSearchFacets().then(setFacets).catch(console.error);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const runSearch = useCallback(async (crit) => {
    setLoading(true);
    setPage(1);
    try {
      const data = await api.searchConversations(crit);
      setResults(data.results || []);
    } catch (err) {
      console.error('Recherche échouée', err);
      setResults([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, []);

  function update(field, value) {
    setCriteria((c) => ({ ...c, [field]: value }));
  }
  function reset() {
    setCriteria(EMPTY);
    setResults([]);
    setSearched(false);
    inputRef.current?.focus();
  }

  // Applique une periode predefinie (chips). NE LANCE PAS la recherche : ca
  // remplit juste les champs Du/Au. L'utilisateur clique "Lancer la recherche".
  function applyPreset(key) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const iso = (date) => {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    let from = '', to = '';
    if (key === 'today')        { from = iso(new Date(y, m, d));     to = iso(new Date(y, m, d)); }
    else if (key === '7days')   { from = iso(new Date(y, m, d - 6)); to = iso(new Date(y, m, d)); }
    else if (key === 'this_m')  { from = iso(new Date(y, m, 1));     to = iso(new Date(y, m + 1, 0)); }
    else if (key === 'last_m')  { from = iso(new Date(y, m - 1, 1)); to = iso(new Date(y, m, 0)); }
    else if (key === '3months') { from = iso(new Date(y, m - 2, 1)); to = iso(new Date(y, m + 1, 0)); }
    else if (key === 'this_y')  { from = iso(new Date(y, 0, 1));     to = iso(new Date(y, 11, 31)); }
    else if (key === 'all')     { from = ''; to = ''; }
    setCriteria((c) => ({ ...c, date_from: from, date_to: to }));
  }

  // Touche Entrée dans le champ mot-cle lance la recherche.
  function onKeyDownQ(e) {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(criteria); }
  }

  const totalConvs = results.length;
  const totalSnippets = results.reduce((s, r) => s + (r.snippets?.length || 0), 0);
  const activeFilters =
    (criteria.date_from || criteria.date_to ? 1 : 0) +
    (criteria.judge ? 1 : 0) + (criteria.chairman ? 1 : 0);

  const fieldStyle = {
    padding: '8px 10px', fontSize: 13, border: '1px solid var(--border-2, #d9dee5)',
    borderRadius: 8, outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-main, #fff)',
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };

  return (
    <div className="main">
      {/* En-tete */}
      <div className="main-header" style={{ justifyContent: 'space-between' }}>
        <div className="main-header-title">🔍 Recherche dans l'historique</div>
        {onClose && (
          <button className="export-btn" onClick={onClose} title="Revenir">← Retour</button>
        )}
      </div>

      {/* Barre de filtres : tout sur UNE ligne ; les chips juste en dessous */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border, #eceef1)', background: 'var(--bg-card, #fafbfc)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            ref={inputRef}
            type="text"
            value={criteria.q}
            onChange={(e) => update('q', e.target.value)}
            onKeyDown={onKeyDownQ}
            placeholder="Mot-clé (optionnel) — Entrée pour lancer"
            title="Mot-clé dans questions, réponses des juges et synthèses (optionnel)"
            style={{ ...fieldStyle, flex: '1 1 220px', minWidth: 180, height: 36, fontSize: 14, padding: '0 12px' }}
          />
          <input
            type="date" value={criteria.date_from} max={criteria.date_to || undefined}
            onChange={(e) => update('date_from', e.target.value)}
            title="Du" aria-label="Du"
            style={{ ...fieldStyle, height: 36, padding: '0 8px' }}
          />
          <input
            type="date" value={criteria.date_to} min={criteria.date_from || undefined}
            onChange={(e) => update('date_to', e.target.value)}
            title="Au" aria-label="Au"
            style={{ ...fieldStyle, height: 36, padding: '0 8px' }}
          />
          <select
            value={criteria.judge} onChange={(e) => update('judge', e.target.value)}
            title="Juge (modèle du conseil)" aria-label="Juge"
            style={{ ...fieldStyle, height: 36, padding: '0 8px', minWidth: 140 }}
          >
            <option value="">Tous les juges</option>
            {facets.judges.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
          <select
            value={criteria.chairman} onChange={(e) => update('chairman', e.target.value)}
            title="Président (modèle de synthèse)" aria-label="Président"
            style={{ ...fieldStyle, height: 36, padding: '0 8px', minWidth: 140 }}
          >
            <option value="">Tous les présidents</option>
            {facets.chairmen.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button
            onClick={() => runSearch(criteria)}
            disabled={loading}
            style={{
              height: 36, padding: '0 16px', fontSize: 13, fontWeight: 600,
              background: 'var(--accent, #5d83d4)', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              opacity: loading ? 0.7 : 1, whiteSpace: 'nowrap',
            }}
            title="Lancer la recherche (vide = tout l'historique)"
          >
            🔎 Lancer
          </button>
          <button
            className="export-btn"
            onClick={reset}
            style={{ height: 36, whiteSpace: 'nowrap' }}
            title="Effacer tous les critères"
          >
            Réinitialiser
          </button>
        </div>

        {/* Chips : périodes prédéfinies */}
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            ['today',   'Aujourd\'hui'],
            ['7days',   '7 derniers jours'],
            ['this_m',  'Ce mois'],
            ['last_m',  'Mois dernier'],
            ['3months', '3 derniers mois'],
            ['this_y',  'Cette année'],
            ['all',     'Tout'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 999,
                border: '1px solid var(--border-2, #d9dee5)', background: 'var(--bg-main, #fff)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent, #5d83d4)'; e.currentTarget.style.color = 'var(--accent, #5d83d4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-2, #d9dee5)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', minHeight: 16 }}>
          {loading && 'Recherche en cours…'}
          {!loading && searched && totalConvs > 0 &&
            `${totalConvs} conversation${totalConvs > 1 ? 's' : ''}${totalSnippets ? ` · ${totalSnippets} passage${totalSnippets > 1 ? 's' : ''}` : ''}${activeFilters ? ` · ${activeFilters} filtre${activeFilters > 1 ? 's' : ''} actif${activeFilters > 1 ? 's' : ''}` : ''}`}
          {!loading && searched && totalConvs === 0 && 'Aucun résultat pour ces critères.'}
          {!loading && !searched && 'Tape un mot-clé, choisis un filtre, ou clique « 🔎 Lancer la recherche » pour tout voir.'}
        </div>
      </div>

      {/* Resultats — scroll interne, comme .chat-messages dans ChatInterface */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>

        {/* Barre toolbar : selecteur de vue + nombre total */}
        {searched && totalConvs > 0 && (() => {
          const totalPages = Math.max(1, Math.ceil(totalConvs / PAGE_SIZE));
          const safePage = Math.min(page, totalPages);
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Page {safePage} / {totalPages}
              </div>
              <div style={{ display: 'inline-flex', background: 'var(--bg-main, #fff)', border: '1px solid var(--border-2, #d9dee5)', borderRadius: 8, padding: 3, gap: 2 }} role="group" aria-label="Affichage">
                {[
                  ['list', '📋 Liste'],
                  ['grid', '🔲 Grille'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    style={{
                      background: view === key ? 'var(--accent, #5d83d4)' : 'transparent',
                      color: view === key ? '#fff' : 'var(--text-secondary)',
                      border: 'none', padding: '5px 10px', fontSize: 12, fontWeight: 600,
                      borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Liste des resultats : liste OU grille 2 cols, page courante uniquement */}
        {(() => {
          const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
          const safePage = Math.min(page, totalPages);
          const start = (safePage - 1) * PAGE_SIZE;
          const visible = results.slice(start, start + PAGE_SIZE);
          const gridMode = view === 'grid';

          return (
            <>
              <div
                style={
                  gridMode
                    ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }
                    : { display: 'flex', flexDirection: 'column', gap: 0 }
                }
              >
                {visible.map((r) => {
                  // En grille : 2 snippets max (typiquement Question + Synthèse président)
                  const snippetsToShow = gridMode ? r.snippets.slice(0, 2) : r.snippets;
                  const extra = r.snippets.length - snippetsToShow.length;
                  return (
                    <div
                      key={r.id}
                      onClick={() => onSelect(r.id)}
                      title={formatDateTooltip(r.created_at)}
                      style={{
                        border: '1px solid var(--border, #eceef1)', borderRadius: 10, padding: '12px 14px',
                        marginBottom: gridMode ? 0 : 12,
                        cursor: 'pointer', background: 'var(--bg-card, #fff)',
                        transition: 'border-color .12s, box-shadow .12s',
                        minWidth: 0,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent, #5d83d4)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(93,131,212,0.12)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border, #eceef1)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                        <strong style={{ fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{(r.created_at || '').slice(0, 10)}</span>
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {snippetsToShow.map((s, i) => (
                          <div key={i} style={{
                            fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)',
                            ...(gridMode ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
                          }}>
                            <span style={{
                              display: 'inline-block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
                              color: 'var(--accent-hover, #3f63ad)', background: 'var(--bg-blue, #eef3ff)', borderRadius: 4, padding: '1px 6px', marginRight: 6, verticalAlign: 'middle',
                            }}>{s.where}</span>
                            <Highlight text={s.text} start={s.matchStart} end={s.matchEnd} />
                          </div>
                        ))}
                        {gridMode && extra > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            +{extra} autre{extra > 1 ? 's' : ''} passage{extra > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18, paddingTop: 8 }}>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="export-btn"
                    style={{ opacity: safePage <= 1 ? 0.45 : 1, cursor: safePage <= 1 ? 'not-allowed' : 'pointer' }}
                    title="Page précédente"
                  >
                    ← Précédent
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '0 8px' }}>
                    Page <strong style={{ color: 'var(--text-primary)' }}>{safePage}</strong> / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="export-btn"
                    style={{ opacity: safePage >= totalPages ? 0.45 : 1, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer' }}
                    title="Page suivante"
                  >
                    Suivant →
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
