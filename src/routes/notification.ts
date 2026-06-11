import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { createSubscriptionSchema } from '../validations/schemas';
import { isWithinRadius } from '../utils/geolocation';

type NotificationType =
  | 'NEW_SIGHTING'
  | 'REVIEW_REQUESTED'
  | 'REVIEW_COMPLETED'
  | 'EVENT_MERGED'
  | 'ALERT'
  | 'TASK_ASSIGNED'
  | 'MISSED_REPORT';

const router = Router();

const parseCategories = (raw?: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
};

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
        categories: data.categories && data.categories.length > 0
          ? JSON.stringify(data.categories)
          : null,
      },
    });

    const exposed = {
      ...subscription,
      categories: parseCategories(subscription.categories),
    };

    res.status(201).json({ success: true, data: exposed });
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

    const exposed = subscriptions.map((s: any) => ({
      ...s,
      categories: parseCategories(s.categories),
    }));

    res.json({ success: true, data: exposed });
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

    type MatchInfo = {
      subscriptionId: string;
      userId: string;
      matchedType: string;
      regionName?: string;
      distanceKm?: number;
      matchedCategory?: string;
      minCredibility?: number;
    };

    const matches: MatchInfo[] = [];

    for (const sub of subscriptions) {
      if (
        sub.minCredibility != null &&
        sub.minCredibility > sighting.credibilityScore
      ) {
        continue;
      }

      const subCategories = parseCategories(sub.categories);
      if (
        subCategories.length > 0 &&
        sighting.category &&
        !subCategories.includes(sighting.category)
      ) {
        continue;
      }

      if (sub.type === 'general') {
        matches.push({
          subscriptionId: sub.id,
          userId: sub.userId,
          matchedType: 'general',
          matchedCategory:
            subCategories.length > 0 ? subCategories.join('/') : undefined,
          minCredibility: sub.minCredibility ?? undefined,
        });
        continue;
      }

      if (sub.type === 'research' && req.user?.role !== 'PUBLIC') {
        matches.push({
          subscriptionId: sub.id,
          userId: sub.userId,
          matchedType: 'research',
          matchedCategory:
            subCategories.length > 0 ? subCategories.join('/') : undefined,
          minCredibility: sub.minCredibility ?? undefined,
        });
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
          const distance =
            sub.latitude != null && sub.longitude != null
              ? (() => {
                  const R = 6371;
                  const dLat = (sighting.latitude - sub.latitude) * Math.PI / 180;
                  const dLon = (sighting.longitude - sub.longitude) * Math.PI / 180;
                  const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(sub.latitude * Math.PI / 180) *
                      Math.cos(sighting.latitude * Math.PI / 180) *
                      Math.sin(dLon / 2) *
                      Math.sin(dLon / 2);
                  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                })()
              : undefined;

          matches.push({
            subscriptionId: sub.id,
            userId: sub.userId,
            matchedType: 'region',
            regionName: sub.regionName ?? undefined,
            distanceKm: distance ? parseFloat(distance.toFixed(2)) : undefined,
            matchedCategory:
              subCategories.length > 0 ? subCategories.join('/') : undefined,
            minCredibility: sub.minCredibility ?? undefined,
          });
        }
      }
    }

    const matchesByUser = new Map<string, MatchInfo[]>();
    for (const m of matches) {
      if (m.userId === req.user?.id) continue;
      if (!matchesByUser.has(m.userId)) {
        matchesByUser.set(m.userId, []);
      }
      matchesByUser.get(m.userId)!.push(m);
    }

    const totalAlerts = matchesByUser.size;

    if (totalAlerts > 0) {
      const { createBulkNotifications } = await import(
        '../services/notificationService'
      );
      for (const [userId, userMatches] of matchesByUser.entries()) {
        const hitDescriptions: string[] = [];
        for (const match of userMatches) {
          let scope: string;
          if (match.matchedType === 'region') {
            scope = match.regionName
              ? `${match.regionName}${
                  match.distanceKm != null
                    ? `(距离约 ${match.distanceKm}km)`
                    : ''
                }`
              : '您订阅的区域';
          } else if (match.matchedType === 'research') {
            scope = '研究级预警';
          } else {
            scope = '通用预警';
          }

          const categoryNote = match.matchedCategory
            ? `，分类：${match.matchedCategory}`
            : '';
          const credNote = match.minCredibility
            ? `（可信度 ≥ ${match.minCredibility}）`
            : '';

          hitDescriptions.push(
            `【${scope}${credNote}${categoryNote}】`
          );
        }

        const uniqueHits = [...new Set(hitDescriptions)];
        const message =
          `${uniqueHits.join(' + ')} 发现新线索：${sighting.title}（可信度 ${sighting.credibilityScore}/100，分类：${sighting.category || '未分类'}）`;

        await createBulkNotifications({
          userIds: [userId],
          type: 'ALERT' as NotificationType,
          title:
            uniqueHits.length > 1
              ? `多订阅命中预警：新的观测线索（${uniqueHits.length} 条订阅命中）`
              : '区域预警：新的观测线索',
          message,
          relatedSightingId: sighting.id,
        });
      }
    }

    const flatUsers: any[] = [];
    for (const [userId, userMatches] of matchesByUser.entries()) {
      flatUsers.push({
        userId,
        hitCount: userMatches.length,
        hits: userMatches.map((r) => ({
          matchedType: r.matchedType,
          regionName: r.regionName,
          distanceKm: r.distanceKm,
          matchedCategory: r.matchedCategory,
        })),
      });
    }

    res.json({
      success: true,
      data: {
        alertedCount: totalAlerts,
        alertedUsers: flatUsers,
      },
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
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
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
