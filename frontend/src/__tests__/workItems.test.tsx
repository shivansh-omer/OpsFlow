import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { WorkItemsPage } from '../pages/WorkItemsPage';
import { AuthProvider } from '../context/AuthContext';
import { api } from '../api/client';
import { WorkItem } from '../types';

describe('WorkItemsPage Component', () => {
  const sampleWorkItems: WorkItem[] = [
    {
      id: 'item-101',
      title: 'Fix Redis replication lag in cluster',
      description: 'Nodes are lagging 15 seconds behind master',
      type: 'INCIDENT',
      priority: 'HIGH',
      status: 'OPEN',
      version: 1,
      teamId: 'team-1',
      creatorId: 'u-1',
      assigneeId: null,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
      creator: { id: 'u-1', name: 'Alex', email: 'alex@opsflow.io' },
      assignee: null,
    },
    {
      id: 'item-102',
      title: 'Upgrade Docker Engine on worker nodes',
      description: 'Patch CVE-2024-xxxx vulnerabilities',
      type: 'MAINTENANCE',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      version: 2,
      teamId: 'team-1',
      creatorId: 'u-1',
      assigneeId: 'u-2',
      dueDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      team: { id: 'team-1', name: 'Platform Operations', slug: 'platform-ops' },
      creator: { id: 'u-1', name: 'Alex', email: 'alex@opsflow.io' },
      assignee: { id: 'u-2', name: 'Elena', email: 'elena@opsflow.io' },
    },
  ];

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
  });

  const renderWorkItemsPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider>
          <WorkItemsPage />
        </AuthProvider>
      </BrowserRouter>
    );
  };

  it('renders work items table with titles, status badges, and version tokens', async () => {
    vi.spyOn(api, 'listWorkItems').mockResolvedValue({
      workItems: sampleWorkItems,
      pagination: { page: 1, limit: 10, totalItems: 2, totalPages: 1 },
    });

    renderWorkItemsPage();

    await waitFor(() => {
      expect(screen.getByText('Work Items Registry')).toBeInTheDocument();
      expect(screen.getByText('Fix Redis replication lag in cluster')).toBeInTheDocument();
      expect(screen.getByText('Upgrade Docker Engine on worker nodes')).toBeInTheDocument();
      expect(screen.getByText('v1')).toBeInTheDocument();
      expect(screen.getByText('v2')).toBeInTheDocument();
    });
  });

  it('triggers search query with search input on form submit', async () => {
    const listSpy = vi.spyOn(api, 'listWorkItems').mockResolvedValue({
      workItems: [sampleWorkItems[0]],
      pagination: { page: 1, limit: 10, totalItems: 1, totalPages: 1 },
    });

    renderWorkItemsPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search by title or description/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by title or description/i);
    fireEvent.change(searchInput, { target: { value: 'Redis' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'Redis',
        })
      );
    });
  });

  it('renders server-side pagination buttons and increments page when next clicked', async () => {
    const listSpy = vi.spyOn(api, 'listWorkItems').mockResolvedValue({
      workItems: sampleWorkItems,
      pagination: { page: 1, limit: 10, totalItems: 25, totalPages: 3 },
    });

    renderWorkItemsPage();

    await waitFor(() => {
      expect(screen.getByText(/showing page/i)).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
        })
      );
    });
  });

  it('validates creation form fields in CreateWorkItemModal and renders errors', async () => {
    vi.spyOn(api, 'listWorkItems').mockResolvedValue({
      workItems: sampleWorkItems,
      pagination: { page: 1, limit: 10, totalItems: 2, totalPages: 1 },
    });

    renderWorkItemsPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new work item/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new work item/i }));

    // Modal opens
    expect(screen.getByRole('heading', { name: /create work item/i })).toBeInTheDocument();

    const titleInput = screen.getByLabelText(/title/i);
    const descInput = screen.getByLabelText(/description/i);

    // Enter invalid short title
    fireEvent.change(titleInput, { target: { value: 'ab' } });
    fireEvent.change(descInput, { target: { value: 'Valid description here' } });

    fireEvent.click(screen.getByRole('button', { name: /create item/i }));

    await waitFor(() => {
      expect(screen.getByText(/title must be at least 3 characters long/i)).toBeInTheDocument();
    });
  });
});
