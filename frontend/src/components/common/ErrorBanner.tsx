import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  message: string;
  details?: unknown;
  onRetry?: () => void;
}

export const ErrorBanner: React.FC<Props> = ({ message, details, onRetry }) => {
  return (
    <div
      style={{
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        color: '#fca5a5',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        margin: '16px 0',
      }}
      role="alert"
    >
      <AlertCircle style={{ width: '20px', height: '20px', color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: '#fecaca', fontSize: '0.9rem' }}>{message}</div>
        {typeof details === 'string' ? (
          <div style={{ fontSize: '0.8rem', color: '#f87171', marginTop: '4px' }}>{details}</div>
        ) : null}
        {Array.isArray(details) ? (
          <ul style={{ fontSize: '0.8rem', color: '#f87171', marginTop: '6px', paddingLeft: '16px' }}>
            {details.map((d: any, idx) => (
              <li key={idx}>{typeof d === 'string' ? d : d.message || JSON.stringify(d)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn btn-secondary btn-sm"
          style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#fecaca' }}
        >
          <RefreshCw style={{ width: '14px', height: '14px' }} />
          Retry
        </button>
      )}
    </div>
  );
};
