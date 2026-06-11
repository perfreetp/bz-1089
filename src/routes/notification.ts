import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { createSubscriptionSchema } from '../validations/schemas';
import { isWithinRadius } from '../utils/geolocation';

type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';

const router = Router();

router.post(
  '/subscriptions',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = createSubscriptionSchema.parse(req.body);

    if (data.type === 'region' && (!data.latitude || !data.longitude)) {
      res.status(400);
      throw new Error('区域订阅必须指定经纬度');
    }

    const subscription = await prisma.subscription.create({
      data: {
        userId: req.user!.id,
        type: data.type,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusKm: data.radiusKm || 25,
        regionName: data.regionName,
        minCredibility: data.minCredibility,
      },
    });

    res.status(201).json({ success: true, data: subscription });
  })
);

router.get(
  '/subscriptions',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: subscriptions });
  })
);

router.delete(
  '/subscriptions/:id',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const sub = await prisma.subscription.findUnique({
      where: { id: req.params.id },
    });

    if (!sub) {
      res.status(404);
      throw new Error('订阅不存在');
    }

    if (sub.userId !== req.user!.id) {
      res.status(403);
      throw new Error('无权删除此订阅');
    }

    await prisma.subscription.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: '订阅已取消' });
  })
);

router.post(
  '/subscriptions/trigger-alert',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const { sightingId } = req.body;
    const sighting = await prisma.sighting.findUnique({
      where: { id: sightingId },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    const subscriptions = await prisma.subscription.findMany();

    const alertUserIds: string[] = [];

    for (const sub of subscriptions) {
      if (
        sub.minCredibility != null &&
        sub.minCredibility > sighting.credibilityScore
      ) {
        continue;
      }

      if (sub.type === 'general') {
        if (!alertUserIds.includes(sub.userId)) alertUserIds.push(sub.userId);
        continue;
      }

      if (sub.type === 'research' && req.user?.role !== 'PUBLIC') {
        if (!alertUserIds.includes(sub.userId)) alertUserIds.push(sub.userId);
        continue;
      }

      if (
        sub.type === 'region' &&
        sub.latitude != null &&
        sub.longitude != null &&
        sub.radiusKm
      ) {
        if (
          isWithinRadius(
            sub.latitude,
            sub.longitude,
            sighting.latitude,
            sighting.longitude,
            sub.radiusKm
          )
        ) {
          if (!alertUserIds.includes(sub.userId)) alertUserIds.push(sub.userId);
        }
      }
    }

    const recipients = alertUserIds.filter((u) => u !== req.user?.id);

    if (recipients.length > 0) {
      const { createBulkNotifications } = await import('../services/notificationService');
      await createBulkNotifications({
        userIds: recipients,
        type: 'ALERT' as NotificationType,
        title: '区域预警：新的观测线索',
        message: `您订阅的区域有新的观测报告：${sighting.title}`,
        relatedSightingId: sighting.id,
      });
    }

    res.json({
      success: true,
      data: { alertedCount: recipients.length, alertedUserIds: recipients },
    });
  })
);

router.get(
  '/notifications',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const unread = req.query.unread === 'true';

    const where: any = {
      userId: req.user!.id,
      ...(unread ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { userId: req.user!.id, isRead: false },
      }),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  })
);

router.put(
  '/notifications/read',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const { ids } = req.body;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: ids }, userId: req.user!.id },
        data: { isRead: true },
      });
    } else {
      await prisma.notification.updateMany({
        where: { userId: req.user!.id },
        data: { isRead: true },
      });
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.id, isRead: false },
    });

    res.json({ success: true, data: { unreadCount } });
  })
);

router.delete(
  '/notifications/:id',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const notif = await prisma.notification.findUnique({
      where: { id: req.params.id },
    });

    if (!notif) {
      res.status(404);
      throw new Error('通知不存在');
    }

    if (notif.userId !== req.user!.id) {
      res.status(403);
      throw new Error('无权删除');
    }

    await prisma.notification.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: '已删除' });
  })
);

export { router as notificationRoutes };
