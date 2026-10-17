import { User, TeamMember, WorkItem } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      teamMember?: TeamMember;
      workItem?: WorkItem;
    }
  }
}
