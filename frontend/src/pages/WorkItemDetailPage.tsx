import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  User,
  Shield,
  Layers,
  Edit2,
  Check,
  X,
  Play,
  Send,
  CheckCircle,
  XCircle,
  AlertOctagon,
  RefreshCw,
  MessageSquare,
  History,
  AlertTriangle,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api, ApiClientError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ActivityLog,
  Pagination,
  TeamMemberDetails,
  WorkflowAction,
  WorkItem,
  WorkItemComment,
  WorkItemPriority,
  WorkItemType,
} from '../types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { StatusBadge } from '../components/common/StatusBadge';
import { PriorityBadge } from '../components/common/PriorityBadge';
import { TypeBadge } from '../components/common/TypeBadge';
import { TransitionModal } from '../components/work-items/TransitionModal';

function getRejectionReason(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const reason = metadata['reason'];
  return typeof reason === 'string' && reason.trim().length > 0 ? reason : null;
}

export const WorkItemDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, userRoleInActiveTeam } = useAuth();

  const [item, setItem] = useState<WorkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // OCC 409 Conflict State
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editType, setEditType] = useState<WorkItemType>('TASK');
  const [editPriority, setEditPriority] = useState<WorkItemPriority>('MEDIUM');
  const [editAssigneeId, setEditAssigneeId] = useState<string>('');
  const [editDueDate, setEditDueDate] = useState<string>('');
  const [teamMembers, setTeamMembers] = useState<TeamMemberDetails[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editFieldError, setEditFieldError] = useState<string | null>(null);

  // Transition Modal State
  const [transitionAction, setTransitionAction] = useState<WorkflowAction | null>(null);
  const [transitionModalOpen, setTransitionModalOpen] = useState(false);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Comments State
  const [comments, setComments] = useState<WorkItemComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Activity Timeline State
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityPagination, setActivityPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 1,
  });
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Notification Banner
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const fetchWorkItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setConflictError(null);
    try {
      const data = await api.getWorkItem(id);
      setItem(data);
      setEditTitle(data.title);
      setEditDesc(data.description);
      setEditType(data.type);
      setEditPriority(data.priority);
      setEditAssigneeId(data.assigneeId || '');
      setEditDueDate(data.dueDate ? data.dueDate.slice(0, 16) : '');

      // Load team members for assignment
      try {
        const members = await api.getTeamMembers(data.teamId);
        setTeamMembers(members);
      } catch {
        // Ignored
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to fetch work item');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchComments = useCallback(async () => {
    if (!id) return;
    try {
      const list = await api.getWorkItemComments(id);
      setComments(list);
    } catch {
      // Ignored
    }
  }, [id]);

  const fetchActivities = useCallback(async () => {
    if (!id) return;
    setLoadingActivities(true);
    try {
      const res = await api.getWorkItemActivity(id, activityPage, 10);
      setActivities(res.activities);
      setActivityPagination(res.pagination);
    } catch {
      // Ignored
    } finally {
      setLoadingActivities(false);
    }
  }, [id, activityPage]);

  useEffect(() => {
    fetchWorkItem();
    fetchComments();
  }, [fetchWorkItem, fetchComments]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleClaim = async () => {
    if (!item) return;
    try {
      const updated = await api.claimWorkItem(item.id, item.version);
      setItem(updated);
      setSuccessNotice('You have claimed this work item.');
      setTimeout(() => setSuccessNotice(null), 3000);
      fetchActivities();
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.statusCode === 409) {
        setConflictError(err.message);
      } else if (err instanceof ApiClientError) {
        alert(err.message);
      }
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setEditFieldError(null);
    setConflictError(null);

    if (!editTitle.trim() || editTitle.trim().length < 3) {
      setEditFieldError('Title must be at least 3 characters');
      return;
    }
    if (!editDesc.trim()) {
      setEditFieldError('Description is required');
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await api.updateWorkItem(item.id, {
        version: item.version,
        title: editTitle.trim(),
        description: editDesc.trim(),
        type: editType,
        priority: editPriority,
        assigneeId: editAssigneeId || null,
        dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
      });

      setItem(updated);
      setIsEditing(false);
      setSuccessNotice('Work item updated successfully.');
      setTimeout(() => setSuccessNotice(null), 3000);
      fetchActivities();
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.statusCode === 409) {
        setConflictError(
          'Concurrency Conflict (HTTP 409): This work item was modified by another operator or background task. Please review the conflict and refresh the latest version.'
        );
      } else if (err instanceof ApiClientError) {
        setEditFieldError(err.message);
      } else {
        setEditFieldError('Failed to update work item');
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenTransitionModal = (action: WorkflowAction) => {
    setTransitionAction(action);
    setTransitionError(null);
    setTransitionModalOpen(true);
  };

  const handleConfirmTransition = async (reason?: string) => {
    if (!item || !transitionAction) return;
    setTransitionLoading(true);
    setTransitionError(null);
    setConflictError(null);

    try {
      const res = await api.transitionWorkItem(item.id, {
        action: transitionAction,
        version: item.version,
        reason,
      });

      setItem(res.workItem);
      setTransitionModalOpen(false);
      setSuccessNotice(`State transitioned successfully: ${res.transition.action}`);
      setTimeout(() => setSuccessNotice(null), 3000);
      fetchActivities();
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.statusCode === 409) {
        setTransitionModalOpen(false);
        setConflictError(
          'Concurrency Conflict (HTTP 409): The status or version of this item was changed by another operator. Please refresh to load the latest state.'
        );
      } else if (err instanceof ApiClientError) {
        setTransitionError(err.message);
      } else {
        setTransitionError('Transition failed. Please try again.');
      }
    } finally {
      setTransitionLoading(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !newComment.trim()) return;

    setSubmittingComment(true);
    try {
      await api.addWorkItemComment(item.id, newComment.trim());
      setNewComment('');
      fetchComments();
      fetchActivities();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        alert(err.message);
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading work item specifications and state..." />;
  }

  if (error || !item) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <button onClick={() => navigate('/work-items')} className="btn btn-secondary btn-sm" style={{ marginBottom: '16px' }}>
          <ArrowLeft style={{ width: '14px', height: '14px' }} /> Back to Work Items
        </button>
        <ErrorBanner message={error || 'Work item was not found or access is restricted.'} />
      </div>
    );
  }

  // Derive Permissions for current user & item state
  const isViewer = userRoleInActiveTeam === 'VIEWER';
  const isLeadOrAdmin = userRoleInActiveTeam === 'LEAD' || userRoleInActiveTeam === 'ADMIN';
  const isAssignee = item.assigneeId === user?.id;
  const isUnassigned = !item.assigneeId;

  // Separation of Duties check for APPROVAL:
  // Submitter / Assignee cannot approve their own item!
  const isSelfApprovalBlocked = isLeadOrAdmin && isAssignee;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Back button */}
      <div style={{ marginBottom: '16px' }}>
        <Link
          to="/work-items"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
            fontSize: '0.85rem',
          }}
        >
          <ArrowLeft style={{ width: '16px', height: '16px' }} />
          Back to Work Items Registry
        </Link>
      </div>

      {/* HTTP 409 OCC Conflict Banner */}
      {conflictError && (
        <div className="conflict-banner">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertTriangle style={{ width: '22px', height: '22px', color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700, color: '#fecaca', fontSize: '0.95rem' }}>
                Optimistic Concurrency Conflict (HTTP 409)
              </div>
              <div style={{ fontSize: '0.85rem', color: '#fca5a5', marginTop: '4px' }}>
                {conflictError}
              </div>
            </div>
          </div>
          <button
            onClick={fetchWorkItem}
            className="btn btn-primary"
            style={{ backgroundColor: '#ef4444', borderColor: '#dc2626' }}
          >
            <RefreshCw style={{ width: '14px', height: '14px' }} />
            Refresh Latest Version
          </button>
        </div>
      )}

      {/* Success Notification */}
      {successNotice && (
        <div
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.875rem',
          }}
        >
          <Check style={{ width: '16px', height: '16px' }} />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Header Info Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: '300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <TypeBadge type={item.type} />
              <PriorityBadge priority={item.priority} />
              <StatusBadge status={item.status} />
              <span
                className="font-mono"
                style={{
                  fontSize: '0.75rem',
                  backgroundColor: 'var(--bg-surface-elevated)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                OCC Token: v{item.version}
              </span>
            </div>

            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
              {item.title}
            </h1>

            <div
              style={{
                display: 'flex',
                gap: '16px',
                marginTop: '10px',
                fontSize: '0.825rem',
                color: 'var(--text-muted)',
                flexWrap: 'wrap',
              }}
            >
              <div>Team: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.team.name}</span></div>
              <div>Created by: <span style={{ color: 'var(--text-primary)' }}>{item.creator.name}</span></div>
              <div>
                Due: <span style={{ color: item.dueDate && new Date(item.dueDate) < new Date() && item.status !== 'CLOSED' && item.status !== 'RESOLVED' ? '#ef4444' : 'var(--text-primary)' }}>
                  {item.dueDate ? new Date(item.dueDate).toLocaleString() : 'No target date'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Action Button: Claim or Edit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isUnassigned && !isViewer && item.status === 'OPEN' && (
              <button onClick={handleClaim} className="btn btn-primary">
                <UserCheck style={{ width: '16px', height: '16px' }} />
                <span>Claim Item</span>
              </button>
            )}

            {!isViewer && item.status !== 'CLOSED' && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`btn ${isEditing ? 'btn-secondary' : 'btn-secondary'}`}
              >
                {isEditing ? <X style={{ width: '14px', height: '14px' }} /> : <Edit2 style={{ width: '14px', height: '14px' }} />}
                <span>{isEditing ? 'Cancel Edit' : 'Edit Fields'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Workflow State Machine Action Bar */}
        {!isViewer && item.status !== 'CLOSED' && (
          <div
            style={{
              marginTop: '20px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Workflow Transition Actions:
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* OPEN state transitions */}
              {item.status === 'OPEN' && (
                <>
                  <button
                    onClick={() => handleOpenTransitionModal('START_PROGRESS')}
                    disabled={!item.assigneeId}
                    className="btn btn-primary btn-sm"
                    title={!item.assigneeId ? 'Claim or assign this item first to start progress' : ''}
                  >
                    <Play style={{ width: '14px', height: '14px' }} />
                    <span>Start Progress</span>
                  </button>

                  {isLeadOrAdmin && (
                    <button
                      onClick={() => handleOpenTransitionModal('CANCEL')}
                      className="btn btn-danger btn-sm"
                    >
                      <XCircle style={{ width: '14px', height: '14px' }} />
                      <span>Cancel Ticket</span>
                    </button>
                  )}
                </>
              )}

              {/* IN_PROGRESS state transitions */}
              {item.status === 'IN_PROGRESS' && (
                <button
                  onClick={() => handleOpenTransitionModal('SUBMIT_FOR_APPROVAL')}
                  disabled={!isAssignee && !isLeadOrAdmin}
                  className="btn btn-primary btn-sm"
                >
                  <Send style={{ width: '14px', height: '14px' }} />
                  <span>Submit for Peer Approval</span>
                </button>
              )}

              {/* AWAITING_APPROVAL state transitions */}
              {item.status === 'AWAITING_APPROVAL' && isLeadOrAdmin && (
                <>
                  {isSelfApprovalBlocked ? (
                    <div
                      style={{
                        fontSize: '0.775rem',
                        color: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      Separation of duties: You cannot approve your own ticket. Another Lead/Admin must approve.
                    </div>
                  ) : (
                    <button
                      onClick={() => handleOpenTransitionModal('APPROVE')}
                      className="btn btn-success btn-sm"
                    >
                      <CheckCircle style={{ width: '14px', height: '14px' }} />
                      <span>Approve & Resolve</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleOpenTransitionModal('REJECT')}
                    className="btn btn-danger btn-sm"
                  >
                    <XCircle style={{ width: '14px', height: '14px' }} />
                    <span>Reject with Reason</span>
                  </button>
                </>
              )}

              {/* RESOLVED state transitions */}
              {item.status === 'RESOLVED' && isLeadOrAdmin && (
                <button
                  onClick={() => handleOpenTransitionModal('CLOSE')}
                  className="btn btn-secondary btn-sm"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <AlertOctagon style={{ width: '14px', height: '14px' }} />
                  <span>Finalize & Close</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Details / Edit Form vs Activity / Comments */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
        {/* Left Column: Description & Specifications / Edit Form */}
        <div>
          {isEditing ? (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>
                Edit Work Item (OCC v{item.version})
              </h2>

              {editFieldError && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px',
                    fontSize: '0.85rem',
                    marginBottom: '16px',
                  }}
                >
                  {editFieldError}
                </div>
              )}

              <form onSubmit={handleSaveEdit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-title">
                    Title
                  </label>
                  <input
                    id="edit-title"
                    type="text"
                    className="input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={savingEdit}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="edit-desc">
                    Description
                  </label>
                  <textarea
                    id="edit-desc"
                    className="textarea"
                    rows={5}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    disabled={savingEdit}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-type">
                      Type
                    </label>
                    <select
                      id="edit-type"
                      className="select"
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as WorkItemType)}
                      disabled={savingEdit}
                    >
                      <option value="TASK">Task</option>
                      <option value="INCIDENT">Incident</option>
                      <option value="MAINTENANCE">Maintenance</option>
                      <option value="ACCESS_REQUEST">Access Request</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-priority">
                      Priority
                    </label>
                    <select
                      id="edit-priority"
                      className="select"
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value as WorkItemPriority)}
                      disabled={savingEdit}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-assignee">
                      Assignee
                    </label>
                    <select
                      id="edit-assignee"
                      className="select"
                      value={editAssigneeId}
                      onChange={(e) => setEditAssigneeId(e.target.value)}
                      disabled={savingEdit}
                    >
                      <option value="">Unassigned</option>
                      {teamMembers.map((m) => (
                        <option key={m.user.id} value={m.user.id}>
                          {m.user.name} ({m.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-due-date">
                      Due Date
                    </label>
                    <input
                      id="edit-due-date"
                      type="datetime-local"
                      className="input"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      disabled={savingEdit}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsEditing(false)}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                    {savingEdit ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', marginBottom: '14px' }}>
                Operational Description
              </h2>
              <div
                style={{
                  fontSize: '0.925rem',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: '1.6',
                }}
              >
                {item.description}
              </div>
            </div>
          )}

          {/* Comments Section */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '12px',
              }}
            >
              <MessageSquare style={{ width: '18px', height: '18px', color: 'var(--primary)' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Operator Comments</h2>
              <span className="badge badge-open" style={{ fontSize: '0.7rem' }}>
                {comments.length}
              </span>
            </div>

            {/* Existing Comments */}
            {comments.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No comments submitted yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                {comments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: '12px 14px',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>
                          {c.author.name}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                      {c.content}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Comment Form */}
            {!isViewer && (
              <form onSubmit={handleAddComment}>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder="Add an operational update or peer note..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    disabled={submittingComment}
                    required
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={submittingComment || !newComment.trim()}
                  >
                    {submittingComment ? 'Submitting...' : 'Post Comment'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Right Column: Meta details & Audit Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Metadata Card */}
          <div className="card">
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', marginBottom: '12px' }}>
              Item Information
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Assignee:</span>
                <span style={{ fontWeight: 600, color: item.assignee ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {item.assignee ? item.assignee.name : 'Unassigned'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Creator:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.creator.name}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Version (OCC):</span>
                <span className="font-mono" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                  v{item.version}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Created:</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Updated:</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>

          {/* Activity Timeline Card */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <History style={{ width: '16px', height: '16px', color: 'var(--primary)' }} />
                <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>Activity Timeline</h2>
              </div>
            </div>

            {loadingActivities ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Loading timeline...
              </div>
            ) : activities.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No events recorded.
              </div>
            ) : (
              <div className="timeline">
                {activities.map((act) => (
                  <div key={act.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div style={{ fontSize: '0.8rem' }}>
                      <span style={{ fontWeight: 600, color: '#fff' }}>{act.actor.name}</span>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {act.action.toLowerCase().replace('_', ' ')}
                      </span>
                      {act.newValue && (
                        <div style={{ color: 'var(--primary)', marginTop: '2px', fontWeight: 500 }}>
                          → {act.newValue}
                        </div>
                      )}
                      {(() => {
                        const reason = getRejectionReason(act.metadata);
                        return reason ? (
                          <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '2px', fontStyle: 'italic' }}>
                            Reason: "{reason}"
                          </div>
                        ) : null;
                      })()}
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {new Date(act.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Timeline Pagination */}
            {activityPagination.totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '12px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-color)',
                  fontSize: '0.75rem',
                }}
              >
                <button
                  onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                  disabled={activityPage <= 1}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                >
                  <ChevronLeft style={{ width: '12px', height: '12px' }} />
                </button>
                <span style={{ color: 'var(--text-muted)' }}>
                  {activityPage} / {activityPagination.totalPages}
                </span>
                <button
                  onClick={() => setActivityPage((p) => Math.min(activityPagination.totalPages, p + 1))}
                  disabled={activityPage >= activityPagination.totalPages}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                >
                  <ChevronRight style={{ width: '12px', height: '12px' }} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* State Machine Transition Modal */}
      <TransitionModal
        isOpen={transitionModalOpen}
        action={transitionAction}
        onClose={() => setTransitionModalOpen(false)}
        onConfirm={handleConfirmTransition}
        loading={transitionLoading}
        serverError={transitionError}
      />
    </div>
  );
};
