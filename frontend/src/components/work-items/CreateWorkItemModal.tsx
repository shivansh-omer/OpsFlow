import React, { useEffect, useState, useRef } from 'react';
import { X, Plus, AlertCircle, RefreshCw } from 'lucide-react';
import { api, ApiClientError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { TeamMemberDetails, WorkItem, WorkItemPriority, WorkItemType } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (item: WorkItem) => void;
  defaultTeamId?: string;
}

export const CreateWorkItemModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onCreated,
  defaultTeamId,
}) => {
  const { user, activeTeam } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<WorkItemType>('TASK');
  const [priority, setPriority] = useState<WorkItemPriority>('MEDIUM');
  const [teamId, setTeamId] = useState(defaultTeamId || activeTeam?.teamId || '');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');

  const [teamMembers, setTeamMembers] = useState<TeamMemberDetails[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Idempotency Key: maintained across retries of the SAME logical creation
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Reset form and generate fresh idempotency key when modal opens
  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = crypto.randomUUID();
      setTitle('');
      setDescription('');
      setType('TASK');
      setPriority('MEDIUM');
      setTeamId(defaultTeamId || activeTeam?.teamId || user?.memberships[0]?.teamId || '');
      setAssigneeId('');
      setDueDate('');
      setErrorMessage(null);
      setFieldErrors({});
    }
  }, [isOpen, defaultTeamId, activeTeam, user]);

  // Load team members when teamId changes
  useEffect(() => {
    if (!teamId) return;
    let isMounted = true;
    setLoadingMembers(true);
    api
      .getTeamMembers(teamId)
      .then((members) => {
        if (isMounted) {
          setTeamMembers(members);
        }
      })
      .catch(() => {
        if (isMounted) {
          setTeamMembers([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoadingMembers(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [teamId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    // Client-side quick check
    if (!title.trim() || title.trim().length < 3) {
      setFieldErrors((prev) => ({ ...prev, title: 'Title must be at least 3 characters long' }));
      return;
    }
    if (!description.trim()) {
      setFieldErrors((prev) => ({ ...prev, description: 'Description is required' }));
      return;
    }
    if (!teamId) {
      setFieldErrors((prev) => ({ ...prev, teamId: 'Team is required' }));
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        teamId,
        type,
        priority,
        assigneeId: assigneeId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      };

      // Submit with current idempotency key (reused if retried!)
      const newItem = await api.createWorkItem(payload, idempotencyKeyRef.current);
      onCreated(newItem);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setErrorMessage(err.message);
        if (Array.isArray(err.details)) {
          const errorsMap: Record<string, string> = {};
          err.details.forEach((item: any) => {
            if (item.field) {
              errorsMap[item.field] = item.message;
            }
          });
          setFieldErrors(errorsMap);
        }
      } else {
        setErrorMessage('Failed to create work item. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus style={{ width: '20px', height: '20px', color: 'var(--primary)' }} />
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>Create Work Item</h2>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            style={{ padding: '4px', border: 'none', background: 'transparent' }}
            aria-label="Close modal"
          >
            <X style={{ width: '20px', height: '20px', color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {errorMessage && (
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
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="work-item-title">
                Title <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                id="work-item-title"
                type="text"
                className="input"
                placeholder="e.g., PostgreSQL primary failover timeout"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                required
              />
              {fieldErrors.title && <div className="form-error">{fieldErrors.title}</div>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="work-item-description">
                Description <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                id="work-item-description"
                className="textarea"
                rows={4}
                placeholder="Detailed incident or task specifications..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                required
              />
              {fieldErrors.description && <div className="form-error">{fieldErrors.description}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="work-item-team">
                  Team <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  id="work-item-team"
                  className="select"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  disabled={submitting}
                  required
                >
                  {user?.memberships.map((m) => (
                    <option key={m.teamId} value={m.teamId}>
                      {m.teamName}
                    </option>
                  ))}
                </select>
                {fieldErrors.teamId && <div className="form-error">{fieldErrors.teamId}</div>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="work-item-assignee">
                  Assignee
                </label>
                <select
                  id="work-item-assignee"
                  className="select"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  disabled={submitting || loadingMembers}
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="work-item-type">
                  Type
                </label>
                <select
                  id="work-item-type"
                  className="select"
                  value={type}
                  onChange={(e) => setType(e.target.value as WorkItemType)}
                  disabled={submitting}
                >
                  <option value="TASK">Task</option>
                  <option value="INCIDENT">Incident</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="ACCESS_REQUEST">Access Request</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="work-item-priority">
                  Priority
                </label>
                <select
                  id="work-item-priority"
                  className="select"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as WorkItemPriority)}
                  disabled={submitting}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="work-item-due-date">
                Due Date (Optional)
              </label>
              <input
                id="work-item-due-date"
                type="datetime-local"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
              Idempotency fingerprint key: <code style={{ color: 'var(--text-secondary)' }}>{idempotencyKeyRef.current.slice(0, 13)}...</code>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <RefreshCw style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Plus style={{ width: '16px', height: '16px' }} />
                  <span>Create Item</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
