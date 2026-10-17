import React from 'react';
import { WorkItemStatus } from '../../types';

interface Props {
  status: WorkItemStatus;
}

const statusConfig: Record<WorkItemStatus, { label: string; className: string }> = {
  OPEN: { label: 'Open', className: 'badge-open' },
  IN_PROGRESS: { label: 'In Progress', className: 'badge-in_progress' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', className: 'badge-awaiting_approval' },
  RESOLVED: { label: 'Resolved', className: 'badge-resolved' },
  CLOSED: { label: 'Closed', className: 'badge-closed' },
};

export const StatusBadge: React.FC<Props> = ({ status }) => {
  const config = statusConfig[status] || { label: status, className: 'badge-open' };
  return (
    <span className={`badge ${config.className}`}>
      {config.label}
    </span>
  );
};
