import React from 'react';
import { WorkItemType } from '../../types';

interface Props {
  type: WorkItemType;
}

const typeConfig: Record<WorkItemType, { label: string; className: string }> = {
  INCIDENT: { label: 'Incident', className: 'badge-type-incident' },
  TASK: { label: 'Task', className: 'badge-type-task' },
  MAINTENANCE: { label: 'Maintenance', className: 'badge-type-maintenance' },
  ACCESS_REQUEST: { label: 'Access Req', className: 'badge-type-access_request' },
};

export const TypeBadge: React.FC<Props> = ({ type }) => {
  const config = typeConfig[type] || { label: type, className: 'badge-type-task' };
  return (
    <span className={`badge ${config.className}`}>
      {config.label}
    </span>
  );
};
