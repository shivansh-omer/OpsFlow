import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { WorkflowAction } from '../../types';

interface Props {
  isOpen: boolean;
  action: WorkflowAction | null;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
  loading?: boolean;
  serverError?: string | null;
}

export const TransitionModal: React.FC<Props> = ({
  isOpen,
  action,
  onClose,
  onConfirm,
  loading = false,
  serverError = null,
}) => {
  const [reason, setReason] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setClientError(null);
    }
  }, [isOpen, action]);

  if (!isOpen || !action) return null;

  const requiresReason = action === 'REJECT' || action === 'CANCEL';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    if (requiresReason && (!reason.trim() || reason.trim().length < 3)) {
      setClientError('A reason of at least 3 characters is required to proceed.');
      return;
    }

    await onConfirm(reason.trim() || undefined);
  };

  const getModalTitle = () => {
    switch (action) {
      case 'APPROVE':
        return 'Approve Work Item';
      case 'REJECT':
        return 'Reject & Request Changes';
      case 'CLOSE':
        return 'Close Work Item';
      case 'CANCEL':
        return 'Cancel Work Item';
      case 'SUBMIT_FOR_APPROVAL':
        return 'Submit for Gatekeeper Review';
      default:
        return 'Confirm Workflow Transition';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {action === 'APPROVE' && <CheckCircle style={{ width: '20px', height: '20px', color: '#10b981' }} />}
            {action === 'REJECT' && <XCircle style={{ width: '20px', height: '20px', color: '#ef4444' }} />}
            {action === 'CANCEL' && <AlertCircle style={{ width: '20px', height: '20px', color: '#f59e0b' }} />}
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{getModalTitle()}</h2>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {(serverError || clientError) && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  color: '#f87171',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '16px',
                }}
              >
                <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
                <span>{clientError || serverError}</span>
              </div>
            )}

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '16px' }}>
              {action === 'APPROVE' &&
                'Approving this work item certifies that all verification criteria and tests have succeeded. Status will transition to RESOLVED.'}
              {action === 'REJECT' &&
                'Rejecting this work item will return it to IN_PROGRESS status. Please state the specific issues or remediation required.'}
              {action === 'CANCEL' &&
                'Canceling this item will transition it directly to CLOSED. A cancellation rationale is required.'}
              {action === 'CLOSE' &&
                'This will finalize the work item and transition it to CLOSED status.'}
              {action === 'SUBMIT_FOR_APPROVAL' &&
                'Ready for peer review? The work item will transition to AWAITING_APPROVAL and lock active changes.'}
            </p>

            {requiresReason && (
              <div className="form-group">
                <label className="form-label" htmlFor="transition-reason">
                  {action === 'REJECT' ? 'Rejection Reason' : 'Cancellation Reason'}{' '}
                  <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  id="transition-reason"
                  className="textarea"
                  rows={3}
                  placeholder="Explain why this action is being taken (at least 3 characters)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Dismiss
            </button>
            <button
              type="submit"
              className={`btn ${
                action === 'APPROVE'
                  ? 'btn-success'
                  : action === 'REJECT'
                  ? 'btn-danger'
                  : action === 'CANCEL'
                  ? 'btn-warning'
                  : 'btn-primary'
              }`}
              disabled={loading}
            >
              {loading ? (
                <>
                  <RefreshCw style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Confirm {action}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
