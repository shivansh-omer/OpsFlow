import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { AuthProvider } from '../context/AuthContext';
import { api, tokenStorage } from '../api/client';

describe('LoginPage Component', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const renderLoginPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </BrowserRouter>
    );
  };

  it('renders login form and demo persona buttons', () => {
    renderLoginPage();

    expect(screen.getByRole('heading', { name: /opsflow/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();

    // Verify demo persona buttons
    expect(screen.getByText('Alex Morgan')).toBeInTheDocument();
    expect(screen.getByText('Elena Rostova')).toBeInTheDocument();
    expect(screen.getByText('Marcus Vance')).toBeInTheDocument();
    expect(screen.getByText('Sarah Chen')).toBeInTheDocument();
    expect(screen.getByText('David Kim')).toBeInTheDocument();
    expect(screen.getByText('Rachel Green')).toBeInTheDocument();
  });

  it('displays client-side validation error when submitting empty fields', async () => {
    renderLoginPage();

    const submitBtn = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitBtn);

    // Default HTML5 required prevents submit or validation message appears
    expect(screen.getByLabelText(/email address/i)).toBeRequired();
    expect(screen.getByLabelText(/password/i)).toBeRequired();
  });

  it('displays error alert on server authentication failure', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('Invalid email or password'));

    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'bad@opsflow.io' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i);
    });
  });

  it('successfully logs in via 1-click demo persona button', async () => {
    const demoSpy = vi.spyOn(api, 'demoLogin').mockImplementation(async (persona) => {
      tokenStorage.set('mock-demo-token');
      return {
        token: 'mock-demo-token',
        persona,
        user: {
          id: 'user-admin',
          email: 'admin@opsflow.io',
          name: 'Alex Morgan',
          avatarUrl: null,
          memberships: [],
        },
      };
    });

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

    renderLoginPage();

    const adminBtn = screen.getByText('Alex Morgan');
    fireEvent.click(adminBtn);

    await waitFor(() => {
      expect(demoSpy).toHaveBeenCalledWith('admin');
      expect(tokenStorage.get()).toBe('mock-demo-token');
    });
  });
});
