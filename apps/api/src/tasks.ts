/** Incident ↔ agent assignments (AgentTask). */
import type { PrismaClient } from '@prisma/client';

export const TASK_STATES = ['assigned', 'responded', 'completed', 'declined'] as const;

/**
 * Auto-assign up to the category's "Agents to send" active agents in the incident LGA
 * (most recently seen first), skipping agents already on the incident. Returns created count.
 */
export async function assignAgents(prisma: PrismaClient, inc: { id: string; lga: string; categoryId: string | null; category: string }, by: string | null, at = new Date()) {
  const cat = inc.categoryId ? await prisma.reportCategory.findUnique({ where: { id: inc.categoryId } }) : await prisma.reportCategory.findFirst({ where: { name: inc.category } });
  const want = cat?.sendAgentCount ?? 3;
  if (want <= 0) return 0;
  const have = await prisma.agentTask.count({ where: { incidentId: inc.id } });
  if (have >= want) return 0;
  const agents = await prisma.agent.findMany({
    where: { lga: inc.lga, status: 'active', tasks: { none: { incidentId: inc.id } } },
    orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }], take: want - have, select: { id: true },
  });
  if (!agents.length) return 0;
  const r = await prisma.agentTask.createMany({ data: agents.map((a) => ({ agentId: a.id, incidentId: inc.id, assignedBy: by, createdAt: at })), skipDuplicates: true });
  return r.count;
}

/** Mirror incident status onto its open tasks: acted → responded, resolved/fake → completed. */
export async function syncTasks(prisma: PrismaClient, incidentId: string, status: string, at = new Date()) {
  if (status === 'acted') await prisma.agentTask.updateMany({ where: { incidentId, status: 'assigned' }, data: { status: 'responded', respondedAt: at } });
  if (status === 'resolved' || status === 'fake') {
    await prisma.agentTask.updateMany({ where: { incidentId, status: 'assigned' }, data: { status: 'completed', respondedAt: at, completedAt: at } });
    await prisma.agentTask.updateMany({ where: { incidentId, status: 'responded' }, data: { status: 'completed', completedAt: at } });
  }
}
