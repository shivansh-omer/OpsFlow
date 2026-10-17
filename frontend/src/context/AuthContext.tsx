import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { api, setUnauthorizedHandler, tokenStorage } from '../api/client';
import { Role, Team, TeamMembership, UserProfile } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  activeTeam: TeamMembership | null;
  teams: Team[];
  userRoleInActiveTeam: Role | null;
  login: (email: string, password: string) => Promise<void>;
  demoLogin: (persona: string) => Promise<void>;
  logout: () => void;
  setActiveTeamId: (teamId: string) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    setActiveTeamIdState(null);
    setTeams([]);
  }, []);

  const refreshUser = useCallback(async () => {
    const token = tokenStorage.get();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const profile = await api.getMe();
      setUser(profile);

      // Load teams for stats & details
      try {
        const teamList = await api.getTeams();
        setTeams(teamList);
      } catch {
        // Fallback to memberships if getTeams fails
      }

      // Default active team to first membership if none selected or no longer valid
      setActiveTeamIdState((prev) => {
        if (prev && profile.memberships.some((m) => m.teamId === prev)) {
          return prev;
        }
        return profile.memberships[0]?.teamId || null;
      });
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
    refreshUser();
  }, [refreshUser, logout]);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      await api.login(email, password);
      await refreshUser();
    } finally {
      setLoading(false);
    }
  };

  const demoLogin = async (persona: string) => {
    setLoading(true);
    try {
      await api.demoLogin(persona);
      await refreshUser();
    } finally {
      setLoading(false);
    }
  };

  const setActiveTeamId = (teamId: string) => {
    if (user?.memberships.some((m) => m.teamId === teamId)) {
      setActiveTeamIdState(teamId);
    }
  };

  const activeTeam = useMemo(() => {
    if (!user || !activeTeamId) return null;
    return user.memberships.find((m) => m.teamId === activeTeamId) || user.memberships[0] || null;
  }, [user, activeTeamId]);

  const userRoleInActiveTeam = useMemo(() => {
    return activeTeam ? activeTeam.role : null;
  }, [activeTeam]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeTeam,
        teams,
        userRoleInActiveTeam,
        login,
        demoLogin,
        logout,
        setActiveTeamId,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
