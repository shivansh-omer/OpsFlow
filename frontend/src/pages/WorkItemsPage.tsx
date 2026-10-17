import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search,
  Filter,
  Plus,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  CheckCircle2,
} from 'lucide-react';
import { api, ApiClientError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { WorkItem, WorkItemPriority, WorkItemStatus, WorkItemType } from '../types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { StatusBadge } from '../components/common/StatusBadge';
import { PriorityBadge } from '../components/common/PriorityBadge';
import { TypeBadge } from '../components/common/TypeBadge';
import { CreateWorkItemModal } from '../components/work-items/CreateWorkItemModal';

export const WorkItemsPage: React.FC = () => {
  const { user, activeTeam, userRoleInActiveTeam } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search & Filters derived from searchParams or defaults
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const search = searchParams.get('search') || '';
  const status = (searchParams.get('status') as WorkItemStatus) || '';
  const priority = (searchParams.get('priority') as WorkItemPriority) || '';
  const type = (searchParams.get('type') as WorkItemType) || '';
  const assigned = searchParams.get('assigned') || '';
  const assigneeIdParam = searchParams.get('assigneeId') || '';
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc';

  const [searchInput, setSearchInput] = useState(search);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let resolvedAssigneeId: string | undefined = undefined;
      if (assigned === 'me' && user) {
        resolvedAssigneeId = user.id;
      } else if (assigneeIdParam) {
        resolvedAssigneeId = assigneeIdParam;
      }

      const res = await api.listWorkItems({
        page,
        limit,
        teamId: activeTeam?.teamId,
        status: status || undefined,
        priority: priority || undefined,
        type: type || undefined,
        assigneeId: resolvedAssigneeId,
        search: search || undefined,
        sortBy,
        sortOrder,
      });

      setItems(res.workItems);
      setTotalPages(res.pagination.totalPages);
      setTotalItems(res.pagination.totalItems);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to load work items');
      }
    } finally {
      setLoading(false);
    }
  }, [page, limit, activeTeam, status, priority, type, assigned, assigneeIdParam, search, sortBy, sortOrder, user]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    // Reset to page 1 on filter modification
    if (key !== 'page') {
      next.set('page', '1');
    }
    setSearchParams(next);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateParam('search', searchInput.trim());
  };

  const isViewer = userRoleInActiveTeam === 'VIEWER';

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            Work Items Registry
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {activeTeam ? `${activeTeam.teamName} items` : 'All accessible items across your teams'}{' '}
            • <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{totalItems} total</span>
          </p>
        </div>

        {!isViewer && (
          <button onClick={() => setCreateModalOpen(true)} className="btn btn-primary">
            <Plus style={{ width: '16px', height: '16px' }} />
            <span>New Work Item</span>
          </button>
        )}
      </div>

      {successBanner && (
        <div
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.875rem',
          }}
        >
          <CheckCircle2 style={{ width: '16px', height: '16px' }} />
          <span>{successBanner}</span>
        </div>
      )}

      {/* Filter and Search Controls Bar */}
      <div
        className="card"
        style={{
          padding: '16px',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', flex: '1', minWidth: '260px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '16px',
                  height: '16px',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                className="input"
                style={{ paddingLeft: '36px' }}
                placeholder="Search by title or description..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              Search
            </button>
          </form>

          {/* Quick Filter: Assigned to me */}
          <button
            onClick={() => updateParam('assigned', assigned === 'me' ? '' : 'me')}
            className={`btn ${assigned === 'me' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.825rem' }}
          >
            <UserCheck style={{ width: '14px', height: '14px' }} />
            <span>Assigned to Me</span>
          </button>
        </div>

        {/* Filter Dropdowns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '10px',
            paddingTop: '8px',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Status
            </label>
            <select
              className="select"
              value={status}
              onChange={(e) => updateParam('status', e.target.value)}
              style={{ fontSize: '0.825rem' }}
            >
              <option value="">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="AWAITING_APPROVAL">Awaiting Approval</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Priority
            </label>
            <select
              className="select"
              value={priority}
              onChange={(e) => updateParam('priority', e.target.value)}
              style={{ fontSize: '0.825rem' }}
            >
              <option value="">All Priorities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Type
            </label>
            <select
              className="select"
              value={type}
              onChange={(e) => updateParam('type', e.target.value)}
              style={{ fontSize: '0.825rem' }}
            >
              <option value="">All Types</option>
              <option value="TASK">Task</option>
              <option value="INCIDENT">Incident</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="ACCESS_REQUEST">Access Request</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Sort By
            </label>
            <select
              className="select"
              value={sortBy}
              onChange={(e) => updateParam('sortBy', e.target.value)}
              style={{ fontSize: '0.825rem' }}
            >
              <option value="createdAt">Created Date</option>
              <option value="updatedAt">Updated Date</option>
              <option value="priority">Priority</option>
              <option value="dueDate">Due Date</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Order
            </label>
            <select
              className="select"
              value={sortOrder}
              onChange={(e) => updateParam('sortOrder', e.target.value)}
              style={{ fontSize: '0.825rem' }}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchItems} />}

      {/* Work Items Table */}
      {loading ? (
        <LoadingSpinner message="Fetching work items from server..." />
      ) : items.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--text-secondary)',
          }}
        >
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#fff' }}>No work items match your filter criteria.</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Try broadening your search filters or create a new work item.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Title & Team</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Version</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      to={`/work-items/${item.id}`}
                      style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        textDecoration: 'none',
                        display: 'block',
                      }}
                    >
                      {item.title}
                    </Link>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {item.team.name} • Created by {item.creator.name}
                    </div>
                  </td>
                  <td>
                    <TypeBadge type={item.type} />
                  </td>
                  <td>
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>
                    {item.assignee ? (
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {item.assignee.name}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      v{item.version}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Server-Side Pagination Controls */}
      {!loading && totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '20px',
            padding: '12px 16px',
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Showing page <span style={{ color: '#fff', fontWeight: 600 }}>{page}</span> of{' '}
            <span style={{ color: '#fff', fontWeight: 600 }}>{totalPages}</span> ({totalItems} items)
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => updateParam('page', String(page - 1))}
              disabled={page <= 1}
              className="btn btn-secondary btn-sm"
            >
              <ChevronLeft style={{ width: '14px', height: '14px' }} />
              Previous
            </button>
            <button
              onClick={() => updateParam('page', String(page + 1))}
              disabled={page >= totalPages}
              className="btn btn-secondary btn-sm"
            >
              Next
              <ChevronRight style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>
      )}

      {/* Creation Modal */}
      <CreateWorkItemModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={() => {
          setSuccessBanner('Work item successfully created!');
          setTimeout(() => setSuccessBanner(null), 3000);
          fetchItems();
        }}
        defaultTeamId={activeTeam?.teamId}
      />
    </div>
  );
};
