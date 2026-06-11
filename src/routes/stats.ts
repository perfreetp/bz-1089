import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { protect, optionalAuth, requireRoles, UserRole } from '../middleware/auth';
import { heatmapQuerySchema } from '../validations/schemas';
import { generateHeatmapGrid, isWithinRadius } from '../utils/geolocation';

const router = Router();

router.get(
  '/dashboard',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const isResearchTier =
      userRole === 'RESEARCHER' ||
      userRole === 'EXPERT' ||
      userRole === 'ADMIN';

    const publicWhere: any = {
      ...(userRole === 'PUBLIC' ? { contentTier: 'public' } : {}),
    };
    const researchWhere: any = {
      ...(!isResearchTier ? { isResearchTier: 'public' } : {}),
    };

    const [
      totalSightings,
      verifiedCount,
      disprovedCount,
      investigatingCount,
      pendingCount,
      mergedCount,
      totalEvents,
      totalUsers,
      totalAnalyses,
      totalMedia,
      totalContributions,
      sightingsByCategory,
      sightingsByMonth,
      topUsers,
      avgCredibility,
    ] = await Promise.all([
      prisma.sighting.count({ where: publicWhere }),
      prisma.sighting.count({ where: { ...publicWhere, status: 'VERIFIED' } }),
      prisma.sighting.count({ where: { ...publicWhere, status: 'DISPROVED' } }),
      prisma.sighting.count({ where: { ...publicWhere, status: 'INVESTIGATING' } }),
      prisma.sighting.count({ where: { ...publicWhere, status: 'PENDING' } }),
      prisma.sighting.count({ where: { ...publicWhere, status: 'MERGED' } }),
      prisma.event.count({ where: researchWhere }),
      prisma.user.count(),
      prisma.analysis.count({
        where: {
          ...(!isResearchTier ? { isResearch: false } : {}),
        },
      }),
      prisma.media.count(),
      prisma.contribution.count(),
      prisma.$queryRaw`
        SELECT category as name, COUNT(*) as count
        FROM Sighting
        ${userRole === 'PUBLIC' ? Prisma.sql`WHERE contentTier = 'public'` : Prisma.empty}
        GROUP BY category
        ORDER BY count DESC
      `,
      prisma.$queryRaw`
        SELECT
          strftime('%Y-%m', occurredAt) as month,
          COUNT(*) as count
        FROM Sighting
        WHERE occurredAt >= date('now', '-12 months')
          ${userRole === 'PUBLIC' ? Prisma.sql`AND contentTier = 'public'` : Prisma.empty}
        GROUP BY strftime('%Y-%m', occurredAt)
        ORDER BY month ASC
      `,
      prisma.user.findMany({
        orderBy: { contributionPoints: 'desc' },
        take: 10,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          contributionPoints: true,
          reputation: true,
          _count: { select: { sightings: true, analyses: true } },
        },
      }),
      prisma.sighting.aggregate({
        where: publicWhere,
        _avg: { credibilityScore: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalSightings,
          totalEvents,
          totalUsers,
          totalAnalyses,
          totalMedia,
          totalContributions,
          avgCredibilityScore: avgCredibility._avg.credibilityScore || 0,
        },
        statusBreakdown: {
          verified: verifiedCount,
          disproved: disprovedCount,
          investigating: investigatingCount,
          pending: pendingCount,
          merged: mergedCount,
        },
        byCategory: sightingsByCategory,
        byMonth: sightingsByMonth,
        topContributors: topUsers,
      },
    });
  })
);

router.get(
  '/heatmap',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const q = heatmapQuerySchema.parse(req.query);
    const userRole = req.user?.role;

    const where: any = {
      ...(userRole === 'PUBLIC' ? { contentTier: 'public' } : {}),
      ...(q.minCredibility !== undefined
        ? { credibilityScore: { gte: q.minCredibility } }
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

    const sightings: any[] = await prisma.sighting.findMany({
      where,
      select: {
        id: true,
        latitude: true,
        longitude: true,
        credibilityScore: true,
        occurredAt: true,
        title: true,
      },
      take: 5000,
    });

    const points = sightings.map((s: any) => ({
      latitude: s.latitude,
      longitude: s.longitude,
      weight: Math.max(1, s.credibilityScore),
    }));

    const grid = generateHeatmapGrid(points, q.cellSizeKm || 1);

    res.json({
      success: true,
      data: {
        grid,
        rawPoints: points,
        totalSightingsUsed: sightings.length,
        gridCells: grid.length,
      },
    });
  })
);

router.get(
  '/leaderboard',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const period = (req.query.period as string) || 'all';

    const where: any = {};
    if (period === 'week') {
      where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
    } else if (period === 'month') {
      where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
    }

    const contributionsByUser = await prisma.contribution.groupBy({
      by: ['userId'],
      where,
      _sum: { points: true },
      _count: { id: true },
      orderBy: { _sum: { points: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    });

    const userIds = contributionsByUser.map((c) => c.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        avatarUrl: true,
        reputation: true,
        contributionPoints: true,
        _count: { select: { sightings: true, analyses: true, reviewComments: true } },
      },
    });

    const rankItems = contributionsByUser.map((c: any, idx: number) => {
      const user = users.find((u: any) => u.id === c.userId);
      return {
        rank: (page - 1) * limit + idx + 1,
        userId: c.userId,
        user,
        periodPoints: c._sum.points || 0,
        contributionCount: c._count.id,
      };
    });

    const totalParticipants = await prisma.contribution.groupBy({
      by: ['userId'],
      where,
    });

    res.json({
      success: true,
      data: {
        leaderboard: rankItems,
        period,
        totalParticipants: totalParticipants.length,
        pagination: { page, limit },
      },
    });
  })
);

router.get(
  '/region-stats',
  protect,
  requireRoles('EXPERT', 'RESEARCHER', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radiusKm = parseFloat((req.query.radiusKm as string) || '50');

    if (isNaN(lat) || isNaN(lon)) {
      res.status(400);
      throw new Error('经纬度参数必须是数字');
    }

    const latRange = radiusKm / 111;
    const lonRange =
      radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const candidates: any[] = await prisma.sighting.findMany({
      where: {
        latitude: { gte: lat - latRange, lte: lat + latRange },
        longitude: { gte: lon - lonRange, lte: lon + lonRange },
      },
      select: {
        id: true, latitude: true, longitude: true, occurredAt: true,
        credibilityScore: true, category: true, status: true,
      },
      take: 2000,
    });

    const inRadius = candidates.filter((s: any) =>
      isWithinRadius(lat, lon, s.latitude, s.longitude, radiusKm)
    );

    const last30Days = inRadius.filter(
      (s: any) => new Date(s.occurredAt).getTime() > Date.now() - 30 * 24 * 3600 * 1000
    );

    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCred = 0;
    for (const s of inRadius) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
      totalCred += s.credibilityScore;
    }

    res.json({
      success: true,
      data: {
        center: { lat, lon, radiusKm },
        totalSightings: inRadius.length,
        last30Days: last30Days.length,
        avgCredibilityScore: inRadius.length
          ? totalCred / inRadius.length
          : 0,
        byCategory,
        byStatus,
      },
    });
  })
);

router.get(
  '/export-metadata',
  protect,
  requireRoles('EXPERT', 'RESEARCHER', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const isExpert =
      userRole === 'EXPERT' || userRole === 'ADMIN';

    const countByMonth = await prisma.$queryRaw<Array<{month: string; count: number}>>`
      SELECT
        strftime('%Y-%m', occurredAt) as month,
        COUNT(*) as count
      FROM Sighting
      WHERE occurredAt >= date('now', '-24 months')
        ${!isExpert ? Prisma.sql`AND contentTier = 'public'` : Prisma.empty}
      GROUP BY strftime('%Y-%m', occurredAt)
      ORDER BY month ASC
    `;

    const credibilityDistribution = await prisma.$queryRaw<Array<{bin: string; count: number}>>`
      SELECT
        CASE
          WHEN credibilityScore < 20 THEN '0-20'
          WHEN credibilityScore < 40 THEN '20-40'
          WHEN credibilityScore < 60 THEN '40-60'
          WHEN credibilityScore < 80 THEN '60-80'
          ELSE '80-100'
        END as bin,
        COUNT(*) as count
      FROM Sighting
      ${!isExpert ? Prisma.sql`WHERE contentTier = 'public'` : Prisma.empty}
      GROUP BY bin
      ORDER BY bin ASC
    `;

    const mediaSightings = await prisma.sighting.count({
      where: {
        media: { some: {} },
        ...(!isExpert ? { contentTier: 'public' } : {}),
      },
    });

    const total = await prisma.sighting.count({
      where: !isExpert ? { contentTier: 'public' } : {},
    });

    res.json({
      success: true,
      data: {
        monthlyTrend: countByMonth,
        credibilityDistribution,
        mediaCoverage: {
          withMedia: mediaSightings,
          withoutMedia: total - mediaSightings,
          rate: total ? mediaSightings / total : 0,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  })
);

export { router as statsRoutes };
