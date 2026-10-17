import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, LogIn, Users, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiClientError } from '../api/client';

export const LoginPage: React.FC = () => {
  const { login, demoLogin, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleStandardLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async (personaKey: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await demoLogin(personaKey);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(`Failed to sign in as demo persona: ${personaKey}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const demoPersonas = [
    {
      key: 'admin',
      name: 'Alex Morgan',
      role: 'ADMIN',
      badgeClass: 'badge-priority-urgent',
      desc: 'Platform Ops & Incident Response (Full Authority)',
    },
    {
      key: 'lead-platform',
      name: 'Elena Rostova',
      role: 'LEAD',
      badgeClass: 'badge-awaiting_approval',
      desc: 'Platform Operations (Approver)',
    },
    {
      key: 'lead-incident',
      name: 'Marcus Vance',
      role: 'LEAD',
      badgeClass: 'badge-awaiting_approval',
      desc: 'Incident Response (Approver)',
    },
    {
      key: 'member-dev',
      name: 'Sarah Chen',
      role: 'MEMBER',
      badgeClass: 'badge-priority-medium',
      desc: 'Senior SRE (Submitter, Both Teams)',
    },
    {
      key: 'member-junior',
      name: 'David Kim',
      role: 'MEMBER',
      badgeClass: 'badge-priority-medium',
      desc: 'Ops Associate (Incident Response)',
    },
    {
      key: 'viewer',
      name: 'Rachel Green',
      role: 'VIEWER',
      badgeClass: 'badge-open',
      desc: 'Compliance Auditor (Read-Only)',
    },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)',
          padding: '36px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px rgba(59, 130, 246, 0.4)',
              marginBottom: '12px',
            }}
          >
            <Layers style={{ width: '28px', height: '28px', color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            OpsFlow
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
            Operations Under Pressure — High-Reliability Incident & Task Management
          </p>
        </div>

        {/* Error notification */}
        {error && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              color: '#f87171',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '20px',
            }}
            role="alert"
          >
            <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
            <div>{error}</div>
          </div>
        )}

        {/* Standard Email/Password Form */}
        <form onSubmit={handleStandardLogin} style={{ marginBottom: '28px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="email-input">
              Email Address
            </label>
            <input
              id="email-input"
              type="email"
              className="input"
              placeholder="operator@opsflow.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting || loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password-input">
              Password
            </label>
            <input
              id="password-input"
              type="password"
              className="input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting || loading}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={submitting || loading}
          >
            <LogIn style={{ width: '16px', height: '16px' }} />
            {submitting ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        {/* Demo Persona Quick-Login Section */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
              <Users style={{ width: '16px', height: '16px', color: 'var(--primary)' }} />
              <span>DEVELOPMENT DEMO PERSONAS</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ShieldCheck style={{ width: '12px', height: '12px' }} /> Backend-Controlled
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {demoPersonas.map((persona) => (
              <button
                key={persona.key}
                type="button"
                onClick={() => handleDemoLogin(persona.key)}
                disabled={submitting || loading}
                className="btn btn-secondary"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  textAlign: 'left',
                  height: 'auto',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-surface-elevated)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.825rem', color: '#fff' }}>{persona.name}</span>
                  <span className={`badge ${persona.badgeClass}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                    {persona.role}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {persona.desc}
                </div>
              </button>
            ))}
          </div>

          <p style={{ fontSize: '0.725rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px' }}>
            JWT Bearer token stored in temporary session storage. Evaluator credentials: <code style={{ color: 'var(--primary)' }}>password123</code>.
          </p>
        </div>
      </div>
    </div>
  );
};
