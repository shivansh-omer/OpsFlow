import React from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  message?: string;
  className?: string;
}

export const LoadingSpinner: React.FC<Props> = ({ message = 'Loading...', className = '' }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 16px',
        color: 'var(--text-secondary)',
        gap: '12px',
      }}
      className={className}
    >
      <Loader2
        style={{
          width: '28px',
          height: '28px',
          animation: 'spin 1s linear infinite',
          color: 'var(--primary)',
        }}
      />
      <span style={{ fontSize: '0.875rem' }}>{message}</span>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
