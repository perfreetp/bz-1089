import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { protect, isResearchTierAllowed, requireRoles } from '../middleware/auth';
import { createAnalysisSchema, createEventSchema } from '../validations/schemas';
import {
  calculateCredibilityLevel,
  updateCredibilityOnAnalysis,
} from '../utils/credibility';
import { addContribution, createNotification } from '../services/notificationService';

const router = Router();

type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';

router.post(
  '/analyses',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = createAnalysisSchema.parse(req.body);
    const userRole = req.user!.role;

    if (!data.sightingId && !data.eventId) {
      res.status(400);
      throw new Error('必须指定观测记录或事件');
    }

    if (data.isResearch && userRole === 'PUBLIC') {
      res.status(403);
      throw new Error('公共用户无权添加研究级分析');
    }

    const analysis = await prisma.analysis.create({
      data: {
        sightingId: data.sightingId,
        eventId: data.eventId,
        userId: req.user!.id,
        content: data.content,
        confidence: data.confidence || 0.5,
        isResearch: data.isResearch || false,
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, role: true } },
      },
    });

    if (data.sightingId) {
      const sighting = await prisma.sighting.findUnique({
        where: { id: data.sightingId },
      });
      if (sighting) {
        const newScore = updateCredibilityOnAnalysis(
          sighting.credibilityScore,
          data.confidence || 0.5,
          true
        );
        await prisma.sighting.update({
          where: { id: data.sightingId },
          data: {
            credibilityScore: newScore,
            credibilityLevel: calculateCredibilityLevel(newScore),
          },
        });

        if (sighting.userId !== req.user!.id) {
          await createNotification({
            userId: sighting.userId,
            type: 'NEW_SIGHTING' as NotificationType,
            title: '您的观测记录有新的分析结论',
            message: '有研究者为您提交的线索添加了分析结论。',
            relatedSightingId: data.sightingId,
          });
        }
      }
    }

    await addContribution(
      req.user!.id,
      'ADD_ANALYSIS',
      data.isResearch ? 40 : 20,
      data.sightingId
    );

    res.status(201).json({ success: true, data: analysis });
  })
);

router.get(
  '/sighting/:sightingId/analyses',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.sightingId },
      select: { contentTier: true },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }
    if (!isResearchTierAllowed(sighting.contentTier, userRole)) {
      res.status(403);
      throw new Error('无权访问');
    }

    const analyses = await prisma.analysis.findMany({
      where: {
        sightingId: req.params.sightingId,
        ...(userRole === 'PUBLIC' ? { isResearch: false } : {}),
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: analyses });
  })
);

router.get(
  '/events',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const userRole = req.user?.role;

    const where: any = userRole === 'PUBLIC' ? { isResearchTier: 'public' } : {};

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { sightings: true, analyses: true, collaborators: true } },
          tags: true,
          collaborators: {
            include: { user: { select: { id: true, username: true, displayName: true } } },
          },
        },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.event.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        events,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  })
);

router.get(
  '/events/:id',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;

    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        sightings: {
          select: {
            id: true, title: true, occurredAt: true,
            credibilityScore: true, credibilityLevel: true, status: true,
            latitude: true, longitude: true,
          },
        },
        analyses: {
          include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
          ...(userRole === 'PUBLIC' ? { where: { isResearch: false } } : {}),
        },
        tags: true,
        collaborators: {
          include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
        },
      },
    });

    if (!event) {
      res.status(404);
      throw new Error('事件不存在');
    }
    if (!isResearchTierAllowed(event.isResearchTier, userRole)) {
      res.status(403);
      throw new Error('无权访问');
    }

    res.json({ success: true, data: event });
  })
);

router.post(
  '/events',
  protect,
  requireRoles('ADMIN', 'EXPERT', 'RESEARCHER'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = createEventSchema.parse(req.body);

    const event = await prisma.event.create({
      data: {
        title: data.title,
        summary: data.summary,
        description: data.description,
        latitude: data.latitude,
        longitude: data.longitude,
        startedAt: data.startedAt,
        endedAt: data.endedAt,
        isResearchTier: data.isResearchTier || 'public',
        tags: data.tags
          ? { create: data.tags.map((t: string) => ({ tag: t })) }
          : undefined,
        collaborators: {
          create: [
            { userId: req.user!.id, role: 'creator' },
          ],
        },
      },
      include: { collaborators: true, tags: true },
    });

    await addContribution(req.user!.id, 'CREATE_EVENT', 100);

    res.status(201).json({ success: true, data: event });
  })
);

router.post(
  '/events/:id/collaborators',
  protect,
  requireRoles('ADMIN', 'EXPERT', 'RESEARCHER'),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, role = 'collaborator' } = req.body;

    const collab = await prisma.eventCollaborator.create({
      data: {
        eventId: req.params.id,
        userId,
        role,
      },
      include: { user: { select: { id: true, username: true, displayName: true } } },
    });

    await addContribution(userId, 'EVENT_COLLABORATOR', 15);

    res.status(201).json({ success: true, data: collab });
  })
);

router.get(
  '/events/:id/summary',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        sightings: {
          select: {
            id: true, title: true, description: true, occurredAt: true,
            latitude: true, longitude: true,
            witnessCount: true,
            credibilityScore: true, credibilityLevel: true, status: true,
            media: true, analyses: true,
          },
        },
        analyses: {
          include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
        },
        collaborators: true,
        tags: true,
      },
    });

    if (!event) {
      res.status(404);
      throw new Error('事件不存在');
    }

    const avgCredibility =
      event.sightings.length > 0
        ? event.sightings.reduce((s, x) => s + x.credibilityScore, 0) /
          event.sightings.length
        : 0;

    const dates = event.sightings
      .map((s) => new Date(s.occurredAt).getTime())
      .sort();
    const timeRange =
      dates.length > 1
        ? {
            start: new Date(dates[0]).toISOString(),
            end: new Date(dates[dates.length - 1]).toISOString(),
            durationHours: Math.round((dates[dates.length - 1] - dates[0]) / 3600000),
          }
        : null;

    const mediaCount = event.sightings.reduce(
      (s: number, x: any) => s + x.media.length, 0
    );
    const totalWitnesses = event.sightings.reduce(
      (s: number, x: any) => s + x.witnessCount, 0
    );

    const generatedSummary = `
【事件摘要】${event.title}
${event.summary || '（暂无摘要）'}

【统计】
- 关联报告数量：${event.sightingCount} 份
- 平均可信度：${avgCredibility.toFixed(1)} / 100
- 总目击人数：${totalWitnesses} 人
- 媒体证据：${mediaCount} 份
- 参与协作：${event.collaborators.length} 人
- 分析结论：${event.analyses.length} 条
${timeRange ? `- 时间跨度：${timeRange.durationHours} 小时 (${timeRange.start} ~ ${timeRange.end})` : ''}

【标签】${event.tags.map((t: any) => '#' + t.tag).join(' ')}
`.trim();

    res.json({
      success: true,
      data: {
        eventId: event.id,
        title: event.title,
        generatedSummary,
        stats: {
          sightingCount: event.sightingCount,
          avgCredibility,
          totalWitnesses,
          mediaCount,
          collaboratorCount: event.collaborators.length,
          analysisCount: event.analyses.length,
          timeRange,
        },
      },
    });
  })
);

export { router as analysisRoutes };
