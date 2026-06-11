import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { protect, requireRoles, optionalAuth, UserRole, isResearchTierAllowed } from '../middleware/auth';
import { createSightingSchema, querySightingsSchema } from '../validations/schemas';
import { calculateInitialCredibility, calculateCredibilityLevel } from '../utils/credibility';
import { haversineDistanceKm, isWithinRadius } from '../utils/geolocation';
import { addContribution, createNotification } from '../services/notificationService';

type SightingStatus = 'PENDING' | 'VERIFIED' | 'DISPROVED' | 'MERGED' | 'INVESTIGATING';
type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';

const router = Router();

router.post(
  '/',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = createSightingSchema.parse(req.body);
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    const initialScore = calculateInitialCredibility({
      witnessCount: data.witnessCount || 1,
      hasMedia: false,
      userReputation: user?.reputation || 0,
      locationDetail: data.locationName ? 2 : 1,
      descriptionLength: data.description.length,
      weatherReported: !!data.weatherConditions,
    });

    const sighting = await prisma.sighting.create({
      data: {
        userId,
        title: data.title,
        description: data.description,
        category: data.category || 'OTHER',
        latitude: data.latitude,
        longitude: data.longitude,
        locationName: data.locationName,
        occurredAt: data.occurredAt,
        durationSeconds: data.durationSeconds,
        witnessCount: data.witnessCount || 1,
        weatherConditions: data.weatherConditions,
        isAnonymous: data.isAnonymous || false,
        credibilityScore: initialScore,
        credibilityLevel: calculateCredibilityLevel(initialScore),
        contentTier: data.contentTier || 'public',
        status: 'PENDING',
        tags: data.tags
          ? { create: data.tags.map((t) => ({ tag: t })) }
          : undefined,
      },
      include: {
        tags: true,
        user: { select: { id: true, username: true, displayName: true, reputation: true } },
      },
    });

    await addContribution(userId, 'CREATE_SIGHTING', 50, sighting.id);

    const expertUsers = await prisma.user.findMany({
      where: {
        role: { in: ['EXPERT', 'RESEARCHER'] },
      },
      select: { id: true },
    });

    if (expertUsers.length > 0) {
      const { createBulkNotifications } = await import('../services/notificationService');
      await createBulkNotifications({
        userIds: expertUsers.map((u) => u.id),
        type: 'NEW_SIGHTING' as NotificationType,
        title: '新的观测线索已提交',
        message: `${sighting.title}`,
        relatedSightingId: sighting.id,
      });
    }

    res.status(201).json({ success: true, data: sighting });
  })
);

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const q = querySightingsSchema.parse(req.query);
    const userRole = req.user?.role;

    let contentTierWhere: any = {};
    if (!userRole || userRole === 'PUBLIC') {
      contentTierWhere = { contentTier: 'public' };
    } else if (userRole === 'RESEARCHER') {
      contentTierWhere = { contentTier: { in: ['public', 'research'] } };
    }

    const where: any = {
      ...contentTierWhere,
      ...(q.category ? { category: q.category } : {}),
      ...(q.status ? { status: q.status as SightingStatus } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.eventId ? { eventId: q.eventId } : {}),
      ...(q.isFalsePositive !== undefined ? { isFalsePositive: q.isFalsePositive } : {}),
      ...(q.minCredibility !== undefined
        ? { credibilityScore: { gte: q.minCredibility } }
        : {}),
      ...(q.maxCredibility !== undefined
        ? { credibilityScore: { lte: q.maxCredibility } }
        : {}),
      ...(q.startDate || q.endDate
        ? {
            occurredAt: {
              ...(q.startDate ? { gte: q.startDate } : {}),
              ...(q.endDate ? { lte: q.endDate } : {}),
            },
          }
        : {}),
    };

    if (q.minLat && q.maxLat && q.minLon && q.maxLon) {
      where.latitude = { gte: q.minLat, lte: q.maxLat };
      where.longitude = { gte: q.minLon, lte: q.maxLon };
    }

    if (q.search) {
      where.OR = [
        { title: { contains: q.search } },
        { description: { contains: q.search } },
      ];
    }

    const sortField: any =
      q.sortBy === 'credibility' ? 'credibilityScore' : q.sortBy;

    const [sightings, total] = await Promise.all([
      prisma.sighting.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { [sortField]: q.sortOrder },
        include: {
          tags: true,
          media: { take: 3 },
          user: { select: { id: true, username: true, displayName: true } },
          event: { select: { id: true, title: true } },
          _count: { select: { analyses: true, reviewRequests: true } },
        },
      }),
      prisma.sighting.count({ where }),
    ]);

    let resultSightings = sightings as any[];

    if (q.lat && q.lon && q.radiusKm) {
      resultSightings = resultSightings.filter((s: any) =>
        isWithinRadius(
          q.lat!,
          q.lon!,
          s.latitude,
          s.longitude,
          q.radiusKm!
        )
      );
      resultSightings = resultSightings.sort((a, b) => {
        const da = haversineDistanceKm(q.lat!, q.lon!, a.latitude, a.longitude);
        const db = haversineDistanceKm(q.lat!, q.lon!, b.latitude, b.longitude);
        return da - db;
      });
    } else if (q.lat && q.lon) {
      resultSightings = resultSightings.sort((a, b) => {
        const da = haversineDistanceKm(q.lat!, q.lon!, a.latitude, a.longitude);
        const db = haversineDistanceKm(q.lat!, q.lon!, b.latitude, b.longitude);
        return da - db;
      });
    }

    res.json({
      success: true,
      data: {
        sightings: resultSightings,
        pagination: {
          page: q.page,
          limit: q.limit,
          total,
          pages: Math.ceil(total / q.limit),
        },
      },
    });
  })
);

router.get(
  '/nearby',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radiusKm = parseFloat((req.query.radiusKm as string) || '10');
    const limit = parseInt((req.query.limit as string) || '20');
    const userRole = req.user?.role;

    if (isNaN(lat) || isNaN(lon)) {
      res.status(400);
      throw new Error('经纬度参数必须是数字');
    }

    let contentTierWhere: any = {};
    if (!userRole || userRole === 'PUBLIC') {
      contentTierWhere = { contentTier: 'public' };
    } else if (userRole === 'RESEARCHER') {
      contentTierWhere = { contentTier: { in: ['public', 'research'] } };
    }

    const candidates: any[] = await prisma.sighting.findMany({
      where: {
        ...contentTierWhere,
        latitude: { gte: lat - 1, lte: lat + 1 },
        longitude: { gte: lon - 1, lte: lon + 1 },
      },
      include: {
        tags: true,
        media: { take: 2 },
        user: { select: { id: true, username: true, displayName: true } },
      },
      take: 500,
    });

    const withDistance = candidates
      .map((s: any) => ({
        ...s,
        distanceKm: haversineDistanceKm(lat, lon, s.latitude, s.longitude),
      }))
      .filter((s: any) => s.distanceKm <= radiusKm)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    res.json({ success: true, data: withDistance });
  })
);

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;

    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.id },
      include: {
        tags: true,
        media: true,
        analyses: {
          include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
          orderBy: { createdAt: 'desc' },
        },
        reviewRequests: {
          include: {
            reviewer: { select: { id: true, username: true, displayName: true } },
            requester: { select: { id: true, username: true, displayName: true } },
            comments: { include: { user: { select: { id: true, username: true, displayName: true, role: true } } } },
          },
        },
        user: { select: { id: true, username: true, displayName: true, role: true, reputation: true } },
        event: { select: { id: true, title: true, summary: true, sightingCount: true } },
        contributions: {
          include: { user: { select: { id: true, username: true, displayName: true } } },
          take: 10,
        },
      },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    if (!isResearchTierAllowed(sighting.contentTier, userRole)) {
      res.status(403);
      throw new Error('无权访问此分级内容');
    }

    res.json({ success: true, data: sighting });
  })
);

router.put(
  '/:id/false-positive',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.id },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    if (
      sighting.userId !== req.user!.id &&
      req.user!.role !== 'ADMIN' &&
      req.user!.role !== 'EXPERT'
    ) {
      res.status(403);
      throw new Error('无权标记此记录');
    }

    const newStatus = !sighting.isFalsePositive ? 'DISPROVED' as SightingStatus : 'PENDING' as SightingStatus;
    const newScore = !sighting.isFalsePositive
      ? Math.max(0, sighting.credibilityScore - 50)
      : Math.min(100, sighting.credibilityScore + 50);

    const updated = await prisma.sighting.update({
      where: { id: req.params.id },
      data: {
        isFalsePositive: !sighting.isFalsePositive,
        status: newStatus,
        credibilityScore: newScore,
        credibilityLevel: calculateCredibilityLevel(newScore),
      },
    });

    res.json({ success: true, data: updated });
  })
);

router.delete(
  '/:id',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.id },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    if (
      sighting.userId !== req.user!.id &&
      req.user!.role !== 'ADMIN'
    ) {
      res.status(403);
      throw new Error('无权删除此记录');
    }

    await prisma.sighting.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: '已删除' });
  })
);

export { router as sightingRoutes };
