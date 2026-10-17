import {
  ApiResponse,
  DashboardData,
  Pagination,
  Team,
  TeamMemberDetails,
  UserProfile,
  WorkItem,
  ActivityLog,
  WorkItemComment,
  WorkflowAction,
  WorkItemStatus,
} from '../types';

const TOKEN_KEY = 'opsflow_session_token';

export class ApiClientError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Token storage abstraction using strictly sessionStorage
export const tokenStorage = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Ignored if storage unavailable
    }
  },
  remove: (): void => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Ignored
    }
  },
};

type UnauthorizedHandler = () => void;
let onUnauthorizedCallback: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorizedCallback = handler;
}

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
  params?: Record<string, string | number | undefined | null>;
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<{ data: T; pagination?: Pagination }> {
  const token = tokenStorage.get();
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  let url = path;
  if (options.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiClientError(message, 0);
  }

  if (res.status === 401) {
    tokenStorage.remove();
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }

  let json: ApiResponse<T> | null = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errorMsg = json?.error?.message || `Request failed with status ${res.status}`;
    const errorDetails = json?.error?.details;
    throw new ApiClientError(errorMsg, res.status, errorDetails);
  }

  return {
    data: (json?.data as T) ?? (null as unknown as T),
    pagination: json?.pagination,
  };
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    const res = await request<{ token: string; user: UserProfile }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokenStorage.set(res.data.token);
    return res.data;
  },

  demoLogin: async (persona: string) => {
    const res = await request<{ token: string; persona: string; user: UserProfile }>('/api/v1/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ persona }),
    });
    tokenStorage.set(res.data.token);
    return res.data;
  },

  getMe: async () => {
    const res = await request<{ user: UserProfile }>('/api/v1/auth/me');
    return res.data.user;
  },

  logout: () => {
    tokenStorage.remove();
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  },

  // Teams
  getTeams: async () => {
    const res = await request<{ teams: Team[] }>('/api/v1/teams');
    return res.data.teams;
  },

  getTeamMembers: async (teamId: string) => {
    const res = await request<{ teamId: string; members: TeamMemberDetails[] }>(`/api/v1/teams/${teamId}/members`);
    return res.data.members;
  },

  // Dashboard
  getDashboard: async (teamId?: string) => {
    const res = await request<DashboardData>('/api/v1/dashboard', {
      params: { teamId },
    });
    return res.data;
  },

  // Work Items
  listWorkItems: async (filters: {
    page?: number;
    limit?: number;
    teamId?: string;
    status?: string;
    priority?: string;
    type?: string;
    assigneeId?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) => {
    const res = await request<WorkItem[]>('/api/v1/work-items', {
      params: filters as Record<string, string | number | undefined>,
    });
    return {
      workItems: res.data || [],
      pagination: res.pagination || {
        page: filters.page || 1,
        limit: filters.limit || 10,
        totalItems: 0,
        totalPages: 1,
      },
    };
  },

  getWorkItem: async (id: string) => {
    const res = await request<{ workItem: WorkItem }>(`/api/v1/work-items/${id}`);
    return res.data.workItem;
  },

  createWorkItem: async (
    payload: {
      title: string;
      description: string;
      teamId: string;
      type?: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
    },
    idempotencyKey?: string
  ) => {
    const res = await request<{ workItem: WorkItem }>('/api/v1/work-items', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey,
    });
    return res.data.workItem;
  },

  updateWorkItem: async (
    id: string,
    payload: {
      version: number;
      title?: string;
      description?: string;
      type?: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
    }
  ) => {
    const res = await request<{ workItem: WorkItem }>(`/api/v1/work-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return res.data.workItem;
  },

  claimWorkItem: async (id: string, version?: number) => {
    const res = await request<{ workItem: WorkItem }>(`/api/v1/work-items/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify(version ? { version } : {}),
    });
    return res.data.workItem;
  },

  transitionWorkItem: async (
    id: string,
    payload: {
      action?: WorkflowAction;
      targetStatus?: WorkItemStatus;
      version: number;
      reason?: string;
      comment?: string;
    }
  ) => {
    const res = await request<{
      workItem: WorkItem;
      transition: {
        action: string;
        previousStatus: string;
        newStatus: string;
        performedBy: string;
        reason?: string;
        timestamp: string;
      };
    }>(`/api/v1/work-items/${id}/transitions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  },

  getWorkItemActivity: async (id: string, page = 1, limit = 20) => {
    const res = await request<{
      activities: ActivityLog[];
      pagination: Pagination;
    }>(`/api/v1/work-items/${id}/activity`, {
      params: { page, limit },
    });
    return res.data;
  },

  getWorkItemComments: async (id: string) => {
    const res = await request<{ comments: WorkItemComment[] }>(`/api/v1/work-items/${id}/comments`);
    return res.data.comments;
  },

  addWorkItemComment: async (id: string, content: string) => {
    const res = await request<{ comment: WorkItemComment }>(`/api/v1/work-items/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return res.data.comment;
  },
};
