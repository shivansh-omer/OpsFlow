import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkItemDetailPage } from '../pages/WorkItemDetailPage';
import { AuthProvider } from '../context/AuthContext';
import { api, ApiClientError } from '../api/client';
import { WorkItem } from '../types';

describe('WorkItemDetailPage Component', () => {
  const mockWorkItem: WorkItem = {
    id: 'item-200',
    title: 'Migrate Kafka brokers to AWS m6i instances',
    description: 'Decommissioning old instances and updating DNS bootstrap list',
    type: 'MAINTENANCE',
    priority: 'HIGH',
    status: 'AWAITING_APPROVAL',
    version: 3,
    teamId: 'team-1',
    creatorId: 'u-1',
    assigneeId: 'user-member', // Assigned to member, not the current admin
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
    creator: { id: 'u-1', name: 'Alex Morgan', email: 'admin@opsflow.io' },
    assignee: { id: 'user-member', name: 'Sarah Chen', email: 'sarah@opsflow.io' },
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

    vi.spyOn(api, 'getTeams').mockResolvedValue([]);
    vi.spyOn(api, 'getTeamMembers').mockResolvedValue([]);
    vi.spyOn(api, 'getWorkItemComments').mockResolvedValue([
      {
        id: 'comment-1',
        workItemId: 'item-200',
        authorId: 'u-1',
        content: 'Pre-flight checks passed on stage brokers.',
        createdAt: new Date().toISOString(),
        author: { id: 'u-1', name: 'Alex Morgan', email: 'admin@opsflow.io', avatarUrl: null },
      },
    ]);
    vi.spyOn(api, 'getWorkItemActivity').mockResolvedValue({
      activities: [
        {
          id: 'act-1',
          workItemId: 'item-200',
          actorId: 'u-1',
          action: 'CREATED',
          oldValue: null,
          newValue: 'OPEN',
          metadata: null,
          createdAt: new Date().toISOString(),
          actor: { id: 'u-1', name: 'Alex Morgan', email: 'admin@opsflow.io', avatarUrl: null },
        },
      ],
      pagination: { page: 1, limit: 10, totalItems: 1, totalPages: 1 },
    });
  });

  const renderDetailPage = (workItem = mockWorkItem) => {
    vi.spyOn(api, 'getWorkItem').mockResolvedValue(workItem);

    return render(
      <MemoryRouter initialEntries={[`/work-items/${workItem.id}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/work-items/:id" element={<WorkItemDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  };

  it('renders item specifications, OCC token, comments, and activity timeline', async () => {
    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByText('Migrate Kafka brokers to AWS m6i instances')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Decommissioning old instances and updating DNS bootstrap list')
      ).toBeInTheDocument();
    });

    // Check OCC token displayed
    expect(screen.getByText('OCC Token: v3')).toBeInTheDocument();

    // Check comments rendered
    expect(screen.getByText('Pre-flight checks passed on stage brokers.')).toBeInTheDocument();

    // Check activity timeline rendered
    expect(screen.getByText('created')).toBeInTheDocument();
  });

  it('renders prominent Concurrency Conflict (HTTP 409) banner when edit conflict occurs', async () => {
    vi.spyOn(api, 'updateWorkItem').mockRejectedValue(
      new ApiClientError('Work item was modified by another user', 409)
    );

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit fields/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /edit fields/i }));

    const titleInput = screen.getByLabelText(/^title$/i);
    fireEvent.change(titleInput, { target: { value: 'Updated Kafka Title' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/optimistic concurrency conflict/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh latest version/i })).toBeInTheDocument();
    });
  });

  it('enforces rejection reason validation (minimum 3 characters)', async () => {
    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject with reason/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /reject with reason/i }));

    // Rejection modal appears
    expect(screen.getByRole('heading', { name: /reject & request changes/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/rejection reason/i)).toBeInTheDocument();

    const reasonInput = screen.getByLabelText(/rejection reason/i);
    fireEvent.change(reasonInput, { target: { value: 'no' } }); // Less than 3 chars

    fireEvent.click(screen.getByRole('button', { name: /confirm reject/i }));

    await waitFor(() => {
      expect(screen.getByText(/a reason of at least 3 characters is required/i)).toBeInTheDocument();
    });
  });

  it('enforces separation of duties by blocking self-approval when current user is assignee', async () => {
    // Work item assigned to the logged-in admin (Alex Morgan, id: 'user-admin')
    const selfAssignedItem: WorkItem = {
      ...mockWorkItem,
      assigneeId: 'user-admin',
      assignee: { id: 'user-admin', name: 'Alex Morgan', email: 'admin@opsflow.io' },
    };

    renderDetailPage(selfAssignedItem);

    await waitFor(() => {
      expect(
        screen.getByText(/separation of duties: you cannot approve your own ticket/i)
      ).toBeInTheDocument();
    });

    // Approve button should NOT be available to self-approve
    expect(screen.queryByRole('button', { name: /approve & resolve/i })).not.toBeInTheDocument();
  });
});
