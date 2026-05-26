import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// Lit le vrai CHANGELOG.md a la racine du projet (bundle au build par Vite).
import changelog from '../../../CHANGELOG.md?raw';

export default function About({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>À propos — LLM Council</h2>
          <button className="modal-close" onClick={onClose} title="Fermer">×</button>
        </div>
        <div className="modal-body">
          <div style={{
            marginBottom: 16,
            fontFamily: "'Geist Mono', monospace",
            fontSize: 13,
            color: 'var(--accent-hover)',
          }}>
            Version {__APP_VERSION__}
          </div>
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{changelog}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
