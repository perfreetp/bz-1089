import { prisma } from '../lib/prisma';

type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedSightingId?: string;
  relatedEventId?: string;
}) {
  return prisma.notification.create({
    data: params,
  });
}

export async function createBulkNotifications(params: {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  relatedSightingId?: string;
  relatedEventId?: string;
}) {
  if (params.userIds.length === 0) return;
  return prisma.notification.createMany({
    data: params.userIds.map((userId) => ({
      userId,
      type: params.type,
      title: params.title,
      message: params.message,
      relatedSightingId: params.relatedSightingId,
      relatedEventId: params.relatedEventId,
    })),
  });
}

export async function addContribution(
  userId: string,
  actionType: string,
  points: number,
  sightingId?: string
) {
  await prisma.contribution.create({
    data: {
      userId,
      actionType,
      points,
      sightingId,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      contributionPoints: { increment: points },
    },
  });
}
