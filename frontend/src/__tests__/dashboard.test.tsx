import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { AuthProvider } from '../context/AuthContext';
import { api } from '../api/client';
import { DashboardData } from '../types';

describe('DashboardPage Component', () => {
  const mockDashboardData: DashboardData = {
    summary: {
      totalActive: 12,
      byStatus: { OPEN: 4, IN_PROGRESS: 5, AWAITING_APPROVAL: 3 },
      byPriority: { URGENT: 2, HIGH: 4, MEDIUM: 6 },
    },
    assignedToMe: {
      count: 2,
      items: [
        {
          id: 'item-1',
          title: 'Kubernetes ingress controller latency spike',
          description: 'Investigating high p99 latency in prod',
          type: 'INCIDENT',
          priority: 'URGENT',
          status: 'IN_PROGRESS',
          version: 2,
          teamId: 'team-1',
          creatorId: 'u-1',
          assigneeId: 'user-admin',
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
          creator: { id: 'u-1', name: 'Alex', email: 'alex@opsflow.io' },
          assignee: { id: 'user-admin', name: 'Sarah', email: 'sarah@opsflow.io' },
        },
      ],
    },
    unassignedUrgent: {
      count: 1,
      items: [
        {
          id: 'item-2',
          title: 'Database connection pool exhaustion',
          description: 'Pool limit reached in production cluster',
          type: 'INCIDENT',
          priority: 'URGENT',
          status: 'OPEN',
          version: 1,
          teamId: 'team-1',
          creatorId: 'u-2',
          assigneeId: null,
          dueDate: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
          creator: { id: 'u-2', name: 'David', email: 'david@opsflow.io' },
          assignee: null,
        },
      ],
    },
    awaitingMyApproval: {
      count: 1,
      items: [
        {
          id: 'item-3',
          title: 'Renew wildcard TLS certs',
          description: 'Ready for production certificate deployment',
          type: 'MAINTENANCE',
          priority: 'HIGH',
          status: 'AWAITING_APPROVAL',
          version: 3,
          teamId: 'team-1',
          creatorId: 'u-3',
          assigneeId: 'u-3',
          dueDate: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
          creator: { id: 'u-3', name: 'Elena', email: 'elena@opsflow.io' },
          assignee: { id: 'u-3', name: 'Elena', email: 'elena@opsflow.io' },
        },
      ],
    },
    overdue: {
      count: 1,
      items: [
        {
          id: 'item-4',
          title: 'Patch OpenSSL vulnerabilities on edge gateways',
          description: 'SLA deadline expired yesterday',
          type: 'TASK',
          priority: 'HIGH',
          status: 'IN_PROGRESS',
          version: 1,
          teamId: 'team-1',
          creatorId: 'u-1',
          assigneeId: 'user-admin',
          dueDate: new Date(Date.now() - 86400000).toISOString(), // Yesterday
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
          creator: { id: 'u-1', name: 'Alex', email: 'alex@opsflow.io' },
          assignee: { id: 'user-admin', name: 'Sarah', email: 'sarah@opsflow.io' },
        },
      ],
    },
    recentActivity: [
      {
        id: 'act-1',
        workItemId: 'item-1',
        actorId: 'user-admin',
        action: 'STATUS_CHANGED',
        oldValue: 'OPEN',
        newValue: 'IN_PROGRESS',
        metadata: null,
        createdAt: new Date().toISOString(),
        actor: { id: 'user-admin', name: 'Sarah', email: 'sarah@opsflow.io' },
        workItem: {
          id: 'item-1',
          title: 'Kubernetes ingress controller latency spike',
          team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
        },
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.setItem('opsflow_session_token', 'mock-token');

    vi.spyOn(api, 'getMe').mockResolvedValue({
      id: 'user-admin',
      email: 'admin@opsflow.io',
      name: 'Alex Morgan',
      avatarUrl: null,
      memberships: [
        {
          id: 'm1',
          teamId: 'team-1',
          teamName: 'Platform Operations',
          teamSlug: 'platform-ops',
          role: 'ADMIN',
          joinedAt: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(api, 'getTeams').mockResolvedValue([
      {
        id: 'team-1',
        name: 'Platform Operations',
        slug: 'platform-ops',
        description: null,
        myRole: 'ADMIN',
        joinedAt: new Date().toISOString(),
      },
    ]);

    vi.spyOn(api, 'getTeamMembers').mockResolvedValue([]);
  });

  const renderDashboard = () => {
    return render(
      <BrowserRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </BrowserRouter>
    );
  };

  it('renders summary metric counts correctly from backend data', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(mockDashboardData);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Operational Command Center')).toBeInTheDocument();
    });

    // Verify summary stat counters
    expect(screen.getByText('12')).toBeInTheDocument(); // totalActive
    expect(screen.getByText('Total Active Items')).toBeInTheDocument();
    expect(screen.getAllByText('Overdue Items').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Unassigned Urgent')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting Approval').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Assigned to Me').length).toBeGreaterThanOrEqual(1);
  });

  it('renders active queues and tickets with accurate links and actions', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(mockDashboardData);

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText('Kubernetes ingress controller latency spike')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Database connection pool exhaustion')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Renew wildcard TLS certs')
      ).toBeInTheDocument();
    });

    // Unassigned urgent item should display a Claim button
    const claimBtn = screen.getByRole('button', { name: /claim/i });
    expect(claimBtn).toBeInTheDocument();
  });

  it('renders error banner when dashboard API call fails and supports retry', async () => {
    const errorSpy = vi
      .spyOn(api, 'getDashboard')
      .mockRejectedValue(new Error('Network connectivity lost'));

    renderDashboard();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(screen.getByRole('alert')).toHaveTextContent(/network connectivity lost/i);

    errorSpy.mockResolvedValue(mockDashboardData);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Operational Command Center')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });
  });

  it('hides Create Work Item button when user role is VIEWER', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({
      id: 'user-viewer',
      email: 'viewer@opsflow.io',
      name: 'Rachel Green',
      avatarUrl: null,
      memberships: [
        {
          id: 'm1',
          teamId: 'team-1',
          teamName: 'Platform Operations',
          teamSlug: 'platform-ops',
          role: 'VIEWER',
          joinedAt: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      ...mockDashboardData,
      assignedToMe: { count: 0, items: [] },
      unassignedUrgent: { count: 0, items: [] },
      awaitingMyApproval: { count: 0, items: [] },
      overdue: { count: 0, items: [] },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Operational Command Center')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create work item/i })).not.toBeInTheDocument();
    });
  });
});
