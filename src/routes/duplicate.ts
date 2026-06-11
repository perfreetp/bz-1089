import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { protect, requireRoles } from '../middleware/auth';
import { config } from '../config';
import { reportDuplicateSchema, mergeSightingsSchema } from '../validations/schemas';
import {
  textSimilarity,
  computeDuplicateScore,
} from '../utils/similarity';
import { haversineDistanceKm } from '../utils/geolocation';
import { calculateCredibilityLevel } from '../utils/credibility';
import { createNotification } from '../services/notificationService';

type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';

const router = Router();

router.post(
  '/detect/:sightingId',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.sightingId },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    const distanceThreshold =
      parseFloat(req.query.radiusKm as string) ||
      config.duplicateDistanceThresholdKm;
    const timeThreshold =
      parseFloat(req.query.timeHours as string) ||
      config.duplicateTimeThresholdHours;
    const minSimilarity =
      parseFloat(req.query.minSimilarity as string) ||
      config.duplicateMinSimilarity;

    const sightingLat = sighting.latitude;
    const sightingLon = sighting.longitude;
    const occurredAt = new Date(sighting.occurredAt).getTime();

    const startDate = new Date(occurredAt - timeThreshold * 3600 * 1000);
    const endDate = new Date(occurredAt + timeThreshold * 3600 * 1000);

    const latRange = distanceThreshold / 111;
    const lonRange =
      distanceThreshold / (111 * Math.cos((sightingLat * Math.PI) / 180));

    const candidates: any[] = await prisma.sighting.findMany({
      where: {
        id: { not: sighting.id },
        latitude: { gte: sightingLat - latRange, lte: sightingLat + latRange },
        longitude: { gte: sightingLon - lonRange, lte: sightingLon + lonRange },
        occurredAt: { gte: startDate, lte: endDate },
      },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
      },
      take: 100,
    });

    const results = [];
    for (const c of candidates) {
      const distanceKm = haversineDistanceKm(
        sightingLat,
        sightingLon,
        c.latitude,
        c.longitude
      );
      if (distanceKm > distanceThreshold) continue;

      const textSim = textSimilarity(
        `${sighting.title} ${sighting.description}`,
        `${c.title} ${c.description}`
      );
      const timeDiffHours =
        Math.abs(occurredAt - new Date(c.occurredAt).getTime()) / 3600000;
      const categoryMatch = sighting.category === c.category;

      const similarityScore = computeDuplicateScore({
        textSim,
        distanceKm,
        timeDiffHours,
        categoryMatch,
        distanceThresholdKm: distanceThreshold,
        timeThresholdHours: timeThreshold,
      });

      if (similarityScore >= minSimilarity) {
        results.push({
          sightingId: c.id,
          title: c.title,
          occurredAt: c.occurredAt,
          similarityScore,
          distanceKm,
          timeDiffHours,
          textSim,
          categoryMatch,
          credibilityScore: c.credibilityScore,
          status: c.status,
          user: c.user,
        });
      }
    }

    results.sort((a, b) => b.similarityScore - a.similarityScore);

    res.json({
      success: true,
      data: {
        source: {
          id: sighting.id,
          title: sighting.title,
          category: sighting.category,
        },
        duplicates: results,
        total: results.length,
      },
    });
  })
);

router.post(
  '/report',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = reportDuplicateSchema.parse(req.body);

    const [source, duplicate] = await Promise.all([
      prisma.sighting.findUnique({ where: { id: data.sourceSightingId } }),
      prisma.sighting.findUnique({ where: { id: data.duplicateSightingId } }),
    ]);

    if (!source || !duplicate) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    const distanceKm = haversineDistanceKm(
      source.latitude,
      source.longitude,
      duplicate.latitude,
      duplicate.longitude
    );
    const timeDiffHours =
      Math.abs(
        new Date(source.occurredAt).getTime() -
          new Date(duplicate.occurredAt).getTime()
      ) / 3600000;
    const textSim = textSimilarity(
      `${source.title} ${source.description}`,
      `${duplicate.title} ${duplicate.description}`
    );

    const similarity =
      data.similarityScore ??
      computeDuplicateScore({
        textSim,
        distanceKm,
        timeDiffHours,
        categoryMatch: source.category === duplicate.category,
        distanceThresholdKm: config.duplicateDistanceThresholdKm,
        timeThresholdHours: config.duplicateTimeThresholdHours,
      });

    const report = await prisma.duplicateReport.create({
      data: {
        sourceSightingId: data.sourceSightingId,
        duplicateSightingId: data.duplicateSightingId,
        similarityScore: similarity,
        reportedBy: req.user!.id,
      },
    });

    const expertUsers = await prisma.user.findMany({
      where: { role: 'EXPERT' },
      select: { id: true },
    });

    if (expertUsers.length > 0) {
      const { createBulkNotifications } = await import('../services/notificationService');
      await createBulkNotifications({
        userIds: expertUsers.map((u) => u.id),
        type: 'MISSED_REPORT' as NotificationType,
        title: '收到重复报告举报',
        message: `用户举报：${source.title} 与 ${duplicate.title} 高度相似`,
        relatedSightingId: data.sourceSightingId,
      });
    }

    res.status(201).json({
      success: true,
      data: { report, similarityScore: similarity, distanceKm, timeDiffHours },
    });
  })
);

router.get(
  '/reports',
  protect,
  requireRoles('ADMIN', 'EXPERT'),
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const unresolved = req.query.resolved === 'false';

    const where: any = unresolved ? { resolved: false } : {};

    const [reports, total] = await Promise.all([
      prisma.duplicateReport.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { similarityScore: 'desc' },
        include: {
          sourceSighting: {
            select: { id: true, title: true, occurredAt: true, userId: true },
          },
          duplicateSighting: {
            select: { id: true, title: true, occurredAt: true, userId: true },
          },
        },
      }),
      prisma.duplicateReport.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        reports,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  })
);

router.post(
  '/merge/:reportId',
  protect,
  requireRoles('ADMIN', 'EXPERT'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = mergeSightingsSchema.parse(req.body);
    const report = await prisma.duplicateReport.findUnique({
      where: { id: req.params.reportId },
      include: { sourceSighting: true, duplicateSighting: true },
    });

    if (!report) {
      res.status(404);
      throw new Error('重复报告不存在');
    }

    let event: any;
    if (data.targetEventId) {
      event = await prisma.event.findUnique({ where: { id: data.targetEventId } });
      if (!event) {
        res.status(404);
        throw new Error('目标事件不存在');
      }
    } else {
      const avgLat =
        (report.sourceSighting.latitude +
          report.duplicateSighting.latitude) / 2;
      const avgLon =
        (report.sourceSighting.longitude +
          report.duplicateSighting.longitude) / 2;
      const earliest =
        new Date(report.sourceSighting.occurredAt) <
        new Date(report.duplicateSighting.occurredAt)
          ? report.sourceSighting.occurredAt
          : report.duplicateSighting.occurredAt;

      const avgCred =
        (report.sourceSighting.credibilityScore +
          report.duplicateSighting.credibilityScore) / 2;

      event = await prisma.event.create({
        data: {
          title: data.eventTitle || `${report.sourceSighting.title} 聚合事件`,
          summary:
            data.eventSummary ||
            `由多个重复报告自动聚合：${report.sourceSighting.title} 与 ${report.duplicateSighting.title}`,
          latitude: avgLat,
          longitude: avgLon,
          startedAt: earliest,
          credibilityScore: avgCred,
          sightingCount: 2,
          collaborators: {
            create: [{ userId: req.user!.id, role: 'merger' }],
          },
        },
      });
    }

    await prisma.$transaction([
      prisma.sighting.update({
        where: { id: report.sourceSightingId },
        data: {
          eventId: event.id,
          status: 'MERGED',
        },
      }),
      prisma.sighting.update({
        where: { id: report.duplicateSightingId },
        data: {
          eventId: event.id,
          status: 'MERGED',
        },
      }),
    ]);

    await prisma.$transaction([
      prisma.duplicateReport.update({
        where: { id: report.id },
        data: {
          resolved: true,
          merged: true,
          reviewedBy: req.user!.id,
        },
      }),
      prisma.event.update({
        where: { id: event.id },
        data: { sightingCount: { increment: 2 } },
      }),
    ]);

    const notifiedUsers = [
      report.sourceSighting.userId,
      report.duplicateSighting.userId,
    ].filter((id) => id !== req.user!.id);

    for (const uid of [...new Set(notifiedUsers)]) {
      await createNotification({
        userId: uid,
        type: 'EVENT_MERGED' as NotificationType,
        title: '您的报告已被合并到事件',
        message: `专家已将您提交的观测记录合并到事件：${event.title}`,
        relatedEventId: event.id,
      });
    }

    res.json({
      success: true,
      data: { event, reportId: report.id },
    });
  })
);

router.put(
  '/:sightingId/credibility/recalculate',
  protect,
  requireRoles('ADMIN', 'EXPERT'),
  asyncHandler(async (req: Request, res: Response) => {
    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.sightingId },
      include: {
        _count: { select: { media: true, analyses: true, reviewRequests: true } },
        analyses: { select: { confidence: true } },
        reviewRequests: {
          where: { completedAt: { not: null } },
          select: { status: true },
        },
      },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    let newScore = 15;
    newScore += Math.min(sighting.witnessCount * 5, 20);
    newScore +=
      sighting._count.media > 0
        ? Math.min(10 * sighting._count.media, 25)
        : 0;
    newScore +=
      sighting._count.analyses > 0
        ? 10 +
          Math.min(
            sighting.analyses.reduce((s: number, a: any) => s + a.confidence * 5, 0),
            15
          )
        : 0;

    const verifications = sighting.reviewRequests.filter(
      (r: any) => r.status === 'VERIFIED'
    ).length;
    const disproves = sighting.reviewRequests.filter(
      (r: any) => r.status === 'DISPROVED'
    ).length;
    newScore += verifications * 20;
    newScore -= disproves * 30;

    newScore = Math.min(Math.max(newScore, 0), 100);

    const updated = await prisma.sighting.update({
      where: { id: req.params.sightingId },
      data: {
        credibilityScore: newScore,
        credibilityLevel: calculateCredibilityLevel(newScore),
      },
    });

    res.json({ success: true, data: updated });
  })
);

export { router as duplicateRoutes };
