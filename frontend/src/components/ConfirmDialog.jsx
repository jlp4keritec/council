import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Hook : const confirm = useConfirm();
//        const ok = await confirm({ title, message, confirmLabel, cancelLabel, danger });
const ConfirmContext = createContext(() => Promise.resolve(false));

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, confirmLabel, cancelLabel, danger, resolve }

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setState({
        title: options.title || 'Confirmer',
        message: options.message || '',
        confirmLabel: options.confirmLabel || 'Confirmer',
        cancelLabel: options.cancelLabel || 'Annuler',
        danger: !!options.danger,
        resolve,
      });
    });
  }, []);

  function close(answer) {
    if (!state) return;
    state.resolve(answer);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Dialog
          {...state}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function Dialog({ title, message, confirmLabel, cancelLabel, danger, onCancel, onConfirm }) {
  const confirmRef = useRef(null);

  // Fermer sur Echap, valider sur Entree
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', handler);
    const t = setTimeout(() => confirmRef.current?.focus(), 30);
    return () => { window.removeEventListener('keydown', handler); clearTimeout(t); };
  }, [onCancel, onConfirm]);

  const isDanger = danger;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(15, 20, 35, 0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'cd-fade .12s ease-out',
      }}
    >
      <style>{`
        @keyframes cd-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cd-pop { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 420,
          background: 'var(--bg-card, #fff)',
          borderRadius: 14,
          border: '1px solid var(--border, #eceef1)',
          boxShadow: '0 24px 64px rgba(15,20,35,0.18), 0 6px 16px rgba(15,20,35,0.08)',
          padding: '22px 24px 18px',
          animation: 'cd-pop .14s ease-out',
        }}
      >
        <h3 style={{
          margin: 0, fontSize: 16, fontWeight: 700,
          color: isDanger ? '#b04040' : 'var(--text-primary)',
        }}>
          {title}
        </h3>
        {message && (
          <div style={{
            marginTop: 8, fontSize: 14, lineHeight: 1.5,
            color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
          }}>
            {message}
          </div>
        )}
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 600,
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-2, #d9dee5)',
              borderRadius: 8, cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: isDanger ? '#c4453d' : 'var(--accent, #5d83d4)',
              color: '#fff', border: 'none',
              borderRadius: 8, cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
