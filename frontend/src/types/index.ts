export type Role = 'VIEWER' | 'MEMBER' | 'LEAD' | 'ADMIN';

export type WorkItemType = 'INCIDENT' | 'TASK' | 'MAINTENANCE' | 'ACCESS_REQUEST';

export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type WorkItemStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'RESOLVED' | 'CLOSED';

export type ActivityAction =
  | 'CREATED'
  | 'UPDATED'
  | 'CLAIMED'
  | 'ASSIGNED'
  | 'STATUS_CHANGED'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMMENTED';

export type WorkflowAction =
  | 'START_PROGRESS'
  | 'SUBMIT_FOR_APPROVAL'
  | 'APPROVE'
  | 'REJECT'
  | 'CLOSE'
  | 'CANCEL';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface UserProfile extends UserSummary {
  createdAt?: string;
  memberships: TeamMembership[];
}

export interface TeamMembership {
  id: string;
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: Role;
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  myRole: Role;
  joinedAt: string;
  stats?: {
    memberCount: number;
    workItemCount: number;
  };
}

export interface TeamMemberDetails {
  id: string;
  role: Role;
  joinedAt: string;
  user: UserSummary;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  version: number;
  teamId: string;
  creatorId: string;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  team: {
    id: string;
    name: string;
    slug: string;
  };
  creator: UserSummary;
  assignee: UserSummary | null;
}

export interface ActivityLog {
  id: string;
  workItemId: string;
  actorId: string;
  action: ActivityAction;
  oldValue: string | null;
  newValue: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  actor: UserSummary;
  workItem?: {
    id: string;
    title: string;
    team: {
      id: string;
      name: string;
      slug: string;
    };
  };
}

export interface WorkItemComment {
  id: string;
  workItemId: string;
  authorId: string;
  content: string;
  createdAt: string;
  author: UserSummary;
}

export interface DashboardData {
  summary: {
    totalActive: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  assignedToMe: {
    count: number;
    items: WorkItem[];
  };
  unassignedUrgent: {
    count: number;
    items: WorkItem[];
  };
  awaitingMyApproval: {
    count: number;
    items: WorkItem[];
  };
  overdue: {
    count: number;
    items: WorkItem[];
  };
  recentActivity: ActivityLog[];
}

export interface Pagination {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface WorkItemListResponse {
  workItems: WorkItem[];
  pagination: Pagination;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  pagination?: Pagination;
  error?: {
    message: string;
    details?: string | ApiErrorDetail[] | Record<string, unknown>;
  };
}
