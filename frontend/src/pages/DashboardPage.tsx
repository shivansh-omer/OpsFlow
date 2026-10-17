import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  Hourglass,
  Plus,
  ArrowRight,
  UserCheck,
  ShieldAlert,
  Flame,
  Activity,
  User,
  ShieldCheck,
} from 'lucide-react';
import { api, ApiClientError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DashboardData, WorkItem } from '../types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { StatusBadge } from '../components/common/StatusBadge';
import { PriorityBadge } from '../components/common/PriorityBadge';
import { TypeBadge } from '../components/common/TypeBadge';
import { CreateWorkItemModal } from '../components/work-items/CreateWorkItemModal';

export const DashboardPage: React.FC = () => {
  const { activeTeam, userRoleInActiveTeam, loading: authLoading } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDashboard(activeTeam?.teamId);
      setData(res);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to fetch dashboard metrics');
      }
    } finally {
      setLoading(false);
    }
  }, [activeTeam]);

  useEffect(() => {
    if (!authLoading) {
      fetchDashboard();
    }
  }, [fetchDashboard, authLoading]);

  const handleClaim = async (itemId: string, version: number) => {
    try {
      await api.claimWorkItem(itemId, version);
      setActionSuccessMsg('Work item claimed successfully!');
      setTimeout(() => setActionSuccessMsg(null), 3000);
      fetchDashboard();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        alert(err.message);
      } else {
        alert('Failed to claim work item');
      }
    }
  };

  const isViewer = userRoleInActiveTeam === 'VIEWER';

  if ((loading || authLoading) && !data && !error) {
    return <LoadingSpinner message="Calculating operational metrics and active queues..." />;
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Top Banner / Heading */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            Operational Command Center
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '2px' }}>
            {activeTeam
              ? `Real-time queue metrics and audit timeline for ${activeTeam.teamName}`
              : 'Multi-team overview and operational queues'}
          </p>
        </div>

        {!isViewer && (
          <button
            onClick={() => setCreateModalOpen(true)}
            className="btn btn-primary"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <Plus style={{ width: '16px', height: '16px' }} />
            <span>Create Work Item</span>
          </button>
        )}
      </div>

      {actionSuccessMsg && (
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
          <CheckCircle2 style={{ width: '16px', height: '16px' }} />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={fetchDashboard} />}

      {data && (
        <>
          {/* Summary Metric Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '28px',
            }}
          >
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
                <Activity style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <div className="stat-val">{data.summary.totalActive}</div>
                <div className="stat-label">Total Active Items</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                <Clock style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <div className="stat-val" style={{ color: data.overdue.count > 0 ? '#ef4444' : '#fff' }}>
                  {data.overdue.count}
                </div>
                <div className="stat-label">Overdue Items</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
                <Flame style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <div className="stat-val" style={{ color: data.unassignedUrgent.count > 0 ? '#f59e0b' : '#fff' }}>
                  {data.unassignedUrgent.count}
                </div>
                <div className="stat-label">Unassigned Urgent</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#c084fc' }}>
                <Hourglass style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <div className="stat-val">{data.awaitingMyApproval.count}</div>
                <div className="stat-label">Awaiting Approval</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                <UserCheck style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <div className="stat-val">{data.assignedToMe.count}</div>
                <div className="stat-label">Assigned to Me</div>
              </div>
            </div>
          </div>

          {/* Operational Focus Queues Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
              gap: '24px',
              marginBottom: '28px',
            }}
          >
            {/* Queue 1: Assigned to Me */}
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
                  <UserCheck style={{ width: '18px', height: '18px', color: '#10b981' }} />
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Assigned to Me</h2>
                  <span className="badge badge-open" style={{ fontSize: '0.7rem' }}>
                    {data.assignedToMe.count}
                  </span>
                </div>
                <Link
                  to="/work-items?assigned=me"
                  style={{ color: 'var(--primary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                >
                  View all <ArrowRight style={{ width: '12px', height: '12px' }} />
                </Link>
              </div>

              {data.assignedToMe.items.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  No active work items currently assigned to you.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {data.assignedToMe.items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/work-items/${item.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        borderRadius: 'var(--radius-md)',
                        textDecoration: 'none',
                        border: '1px solid var(--border-subtle)',
                        transition: 'border-color 0.15s ease',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <TypeBadge type={item.type} />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                            {item.title}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Due: {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'No deadline'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <PriorityBadge priority={item.priority} />
                        <StatusBadge status={item.status} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Queue 2: Unassigned Urgent */}
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
                  <Flame style={{ width: '18px', height: '18px', color: '#f59e0b' }} />
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Unassigned Urgent Items</h2>
                  <span className="badge badge-priority-urgent" style={{ fontSize: '0.7rem' }}>
                    {data.unassignedUrgent.count}
                  </span>
                </div>
                <Link
                  to="/work-items?priority=URGENT&assigneeId=unassigned"
                  style={{ color: 'var(--primary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                >
                  View all <ArrowRight style={{ width: '12px', height: '12px' }} />
                </Link>
              </div>

              {data.unassignedUrgent.items.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  All urgent items have been claimed or assigned.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {data.unassignedUrgent.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                      }}
                    >
                      <Link
                        to={`/work-items/${item.id}`}
                        style={{ flex: 1, minWidth: 0, textDecoration: 'none', paddingRight: '12px' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <TypeBadge type={item.type} />
                          <span style={{ fontWeight: 600, color: '#fff', fontSize: '0.875rem' }}>
                            {item.title}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Team: {item.team.name}
                        </div>
                      </Link>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <StatusBadge status={item.status} />
                        {!isViewer && (
                          <button
                            onClick={() => handleClaim(item.id, item.version)}
                            className="btn btn-primary btn-sm"
                            title="Claim this urgent item"
                          >
                            Claim
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Queue 3: Awaiting Approval (Lead/Admin gatekeeper view) */}
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
                  <ShieldAlert style={{ width: '18px', height: '18px', color: '#c084fc' }} />
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Awaiting Approval</h2>
                  <span className="badge badge-awaiting_approval" style={{ fontSize: '0.7rem' }}>
                    {data.awaitingMyApproval.count}
                  </span>
                </div>
                <Link
                  to="/work-items?status=AWAITING_APPROVAL"
                  style={{ color: 'var(--primary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                >
                  View queue <ArrowRight style={{ width: '12px', height: '12px' }} />
                </Link>
              </div>

              {data.awaitingMyApproval.items.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  No pending items awaiting gatekeeper approval.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {data.awaitingMyApproval.items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/work-items/${item.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        borderRadius: 'var(--radius-md)',
                        textDecoration: 'none',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <TypeBadge type={item.type} />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                            {item.title}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Assignee: {item.assignee ? item.assignee.name : 'Unassigned'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <PriorityBadge priority={item.priority} />
                        <span className="badge badge-awaiting_approval" style={{ fontSize: '0.7rem' }}>
                          Review
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Queue 4: Overdue Items */}
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
                  <AlertTriangle style={{ width: '18px', height: '18px', color: '#ef4444' }} />
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Overdue Items</h2>
                  <span className="badge badge-priority-urgent" style={{ fontSize: '0.7rem' }}>
                    {data.overdue.count}
                  </span>
                </div>
              </div>

              {data.overdue.items.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  All items are within scheduled SLA timelines.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {data.overdue.items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/work-items/${item.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        borderRadius: 'var(--radius-md)',
                        textDecoration: 'none',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <TypeBadge type={item.type} />
                          <span style={{ fontWeight: 600, color: '#f87171', fontSize: '0.875rem' }}>
                            {item.title}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#fca5a5' }}>
                          Was due: {item.dueDate ? new Date(item.dueDate).toLocaleString() : 'Past due'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <StatusBadge status={item.status} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity Audit Stream */}
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
                <Activity style={{ width: '18px', height: '18px', color: 'var(--primary)' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Recent System Activity</h2>
              </div>
            </div>

            {data.recentActivity.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No recent activity recorded.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {data.recentActivity.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.85rem',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          color: '#fff',
                        }}
                      >
                        {log.actor.name.charAt(0)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, color: '#fff' }}>{log.actor.name}</span>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {log.action.toLowerCase().replace('_', ' ')}
                        </span>{' '}
                        {log.workItem && (
                          <Link
                            to={`/work-items/${log.workItem.id}`}
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}
                          >
                            "{log.workItem.title}"
                          </Link>
                        )}
                        {log.newValue && (
                          <span style={{ marginLeft: '6px' }}>
                            → <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{log.newValue}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Work Item Creation Modal */}
      <CreateWorkItemModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={() => {
          setActionSuccessMsg('Work item created successfully!');
          setTimeout(() => setActionSuccessMsg(null), 3000);
          fetchDashboard();
        }}
        defaultTeamId={activeTeam?.teamId}
      />
    </div>
  );
};
