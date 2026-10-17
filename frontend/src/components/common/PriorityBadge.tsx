import React from 'react';
import { WorkItemPriority } from '../../types';

interface Props {
  priority: WorkItemPriority;
}

const priorityConfig: Record<WorkItemPriority, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'badge-priority-low' },
  MEDIUM: { label: 'Medium', className: 'badge-priority-medium' },
  HIGH: { label: 'High', className: 'badge-priority-high' },
  URGENT: { label: 'Urgent', className: 'badge-priority-urgent' },
};

export const PriorityBadge: React.FC<Props> = ({ priority }) => {
  const config = priorityConfig[priority] || { label: priority, className: 'badge-priority-low' };
  return (
    <span className={`badge ${config.className}`}>
      {config.label}
    </span>
  );
};
