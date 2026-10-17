import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckSquare,
  UserCheck,
  ShieldAlert,
  LogOut,
  Layers,
  ChevronDown,
  Menu,
  X,
  Shield,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const AppLayout: React.FC = () => {
  const { user, activeTeam, userRoleInActiveTeam, logout, setActiveTeamId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleBadgeColor = (role: string | null) => {
    switch (role) {
      case 'ADMIN':
        return '#ef4444';
      case 'LEAD':
        return '#8b5cf6';
      case 'MEMBER':
        return '#3b82f6';
      case 'VIEWER':
      default:
        return '#64748b';
    }
  };

  return (
    <div className="app-container">
      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 490,
          }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <NavLink to="/" className="sidebar-logo" onClick={() => setMobileMenuOpen(false)}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 4px rgba(59, 130, 246, 0.4)',
              }}
            >
              <Layers style={{ width: '18px', height: '18px', color: '#fff' }} />
            </div>
            <div>
              <div style={{ lineHeight: 1.1 }}>OpsFlow</div>
              <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.05em' }}>
                OPERATIONS UNDER PRESSURE
              </div>
            </div>
          </NavLink>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={() => setMobileMenuOpen(false)}
          >
            <LayoutDashboard style={{ width: '18px', height: '18px' }} />
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/work-items"
            end
            className={() => `nav-link ${location.pathname === '/work-items' && !location.search ? 'active' : ''}`}
            onClick={() => setMobileMenuOpen(false)}
          >
            <CheckSquare style={{ width: '18px', height: '18px' }} />
            <span>Work Items</span>
          </NavLink>

          <NavLink
            to="/work-items?assigned=me"
            className={() => `nav-link ${location.search.includes('assigned=me') ? 'active' : ''}`}
            onClick={() => setMobileMenuOpen(false)}
          >
            <UserCheck style={{ width: '18px', height: '18px' }} />
            <span>My Assigned</span>
          </NavLink>

          <NavLink
            to="/work-items?status=AWAITING_APPROVAL"
            className={() => `nav-link ${location.search.includes('status=AWAITING_APPROVAL') ? 'active' : ''}`}
            onClick={() => setMobileMenuOpen(false)}
          >
            <ShieldAlert style={{ width: '18px', height: '18px' }} />
            <span>Approval Queue</span>
          </NavLink>
        </nav>

        {/* Team & Persona context card at bottom */}
        {activeTeam && (
          <div
            style={{
              padding: '16px',
              borderTop: '1px solid var(--border-color)',
              backgroundColor: 'rgba(17, 24, 39, 0.6)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Active Context
            </div>
            <div style={{ marginTop: '6px', fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
              {activeTeam.teamName}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: getRoleBadgeColor(userRoleInActiveTeam),
                }}
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: getRoleBadgeColor(userRoleInActiveTeam),
                  textTransform: 'uppercase',
                }}
              >
                {userRoleInActiveTeam} ROLE
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="main-wrapper">
        <header className="top-bar">
          <div className="top-bar-left">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', padding: '6px 8px' }}
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X style={{ width: '18px', height: '18px' }} /> : <Menu style={{ width: '18px', height: '18px' }} />}
            </button>

            {/* Team Selector */}
            {user && user.memberships.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'none' }}>Team:</span>
                <div style={{ position: 'relative' }}>
                  <select
                    className="select"
                    style={{
                      paddingRight: '30px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      backgroundColor: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      height: '36px',
                    }}
                    value={activeTeam?.teamId || ''}
                    onChange={(e) => setActiveTeamId(e.target.value)}
                    aria-label="Select Team"
                  >
                    {user.memberships.map((m) => (
                      <option key={m.teamId} value={m.teamId}>
                        {m.teamName} ({m.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="top-bar-right">
            {/* Authenticated User Identity */}
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {user.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {user.email}
                  </div>
                </div>

                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    border: `2px solid ${getRoleBadgeColor(userRoleInActiveTeam)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#fff',
                  }}
                  title={`${user.name} (${userRoleInActiveTeam})`}
                >
                  {user.name.charAt(0)}
                </div>

                <button
                  onClick={handleLogout}
                  className="btn btn-secondary btn-sm"
                  title="Sign out of OpsFlow"
                >
                  <LogOut style={{ width: '14px', height: '14px' }} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
