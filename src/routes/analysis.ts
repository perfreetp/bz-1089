import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import {
  protect,
  optionalAuth,
  isResearchTierAllowed,
  requireRoles,
  filterAnalysesByRole,
  getAnalysisVisibilityCounts,
} from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  createAnalysisSchema,
  createEventSchema,
  reviewAnalysisSchema,
} from '../validations/schemas';
import {
  calculateCredibilityLevel,
  updateCredibilityOnAnalysis,
} from '../utils/credibility';
import { addContribution, createNotification } from '../services/notificationService';

const router = Router();

type NotificationType =
  | 'NEW_SIGHTING'
  | 'REVIEW_REQUESTED'
  | 'REVIEW_COMPLETED'
  | 'EVENT_MERGED'
  | 'ALERT'
  | 'TASK_ASSIGNED'
  | 'MISSED_REPORT';

router.post(
  '/analyses',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = createAnalysisSchema.parse(req.body);
    const userRole = req.user!.role;

    if (!data.sightingId && !data.eventId) {
      throw new AppError('必须指定观测记录或事件', 400);
    }

    if (data.isResearch && userRole === 'PUBLIC') {
      throw new AppError('公共用户无权添加研究级分析', 403);
    }

    const isReviewer =
      userRole === 'RESEARCHER' ||
      userRole === 'EXPERT' ||
      userRole === 'ADMIN';

    const analysis = await prisma.analysis.create({
      data: {
        sightingId: data.sightingId,
        eventId: data.eventId,
        userId: req.user!.id,
        content: data.content,
        confidence: data.confidence || 0.5,
        isResearch: data.isResearch || false,
        reviewStatus: isReviewer ? 'APPROVED' : 'PENDING',
        reviewedBy: isReviewer ? req.user!.id : null,
        reviewedAt: isReviewer ? new Date() : null,
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, role: true },
        },
      },
    });

    if (data.sightingId && isReviewer) {
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
            message:
              '有研究者为您提交的线索添加了分析结论。',
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

router.post(
  '/analyses/:id/review',
  protect,
  requireRoles('RESEARCHER', 'EXPERT', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = reviewAnalysisSchema.parse(req.body);

    const analysis = await prisma.analysis.findUnique({
      where: { id: req.params.id },
    });

    if (!analysis) {
      throw new AppError('分析结论不存在', 404);
    }

    const updated = await prisma.analysis.update({
      where: { id: req.params.id },
      data: {
        reviewStatus: data.approved ? 'APPROVED' : 'REJECTED',
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, role: true },
        },
      },
    });

    if (data.approved && analysis.sightingId) {
      const sighting = await prisma.sighting.findUnique({
        where: { id: analysis.sightingId },
      });
      if (sighting) {
        const newScore = updateCredibilityOnAnalysis(
          sighting.credibilityScore,
          analysis.confidence,
          true
        );
        await prisma.sighting.update({
          where: { id: analysis.sightingId },
          data: {
            credibilityScore: newScore,
            credibilityLevel: calculateCredibilityLevel(newScore),
          },
        });
      }

      if (analysis.userId !== req.user!.id) {
        await createNotification({
          userId: analysis.userId,
          type: 'REVIEW_COMPLETED' as NotificationType,
          title: '您提交的分析结论已通过审核',
          message: '研究者已批准您的分析，已对公众可见。',
          relatedSightingId: analysis.sightingId,
        });
      }
    }

    res.json({ success: true, data: updated });
  })
);

router.get(
  '/sightings/:sightingId/analyses',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const userId = req.user?.id;

    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.sightingId },
      select: { contentTier: true },
    });

    if (!sighting) {
      throw new AppError('观测记录不存在', 404);
    }
    if (!isResearchTierAllowed(sighting.contentTier, userRole)) {
      throw new AppError('无权访问', 403);
    }

    const allAnalyses = await prisma.analysis.findMany({
      where: { sightingId: req.params.sightingId },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const visible = filterAnalysesByRole(allAnalyses, userRole, userId);
    const visibility = getAnalysisVisibilityCounts(allAnalyses, userRole);

    res.json({
      success: true,
      data: visible,
      meta: visibility,
    });
  })
);

router.get(
  '/events',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const userRole = req.user?.role;

    let where: any = {};
    if (!userRole || userRole === 'PUBLIC') {
      where = { isResearchTier: 'public' };
    } else if (userRole === 'RESEARCHER') {
      where = { isResearchTier: { in: ['public', 'research'] } };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: { sightings: true, analyses: true, collaborators: true },
          },
          tags: true,
          collaborators: {
            include: {
              user: {
                select: { id: true, username: true, displayName: true },
              },
            },
          },
        },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.event.count({ where }),
    ]);

    const eventsWithCount = events.map((e: any) => {
      const maskedTitle =
        e.isResearchTier === 'public' ||
        (userRole && userRole !== 'PUBLIC')
          ? e.title
          : '【权限受限事件】';
      return {
        ...e,
        title: maskedTitle,
        sightingCount: e._count.sightings,
      };
    });

    res.json({
      success: true,
      data: {
        events: eventsWithCount,
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

router.get(
  '/events/:id',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const userId = req.user?.id;

    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        sightings: {
          select: {
            id: true,
            title: true,
            occurredAt: true,
            credibilityScore: true,
            credibilityLevel: true,
            status: true,
            contentTier: true,
            latitude: true,
            longitude: true,
          },
        },
        analyses: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                role: true,
              },
            },
          },
        },
        tags: true,
        collaborators: {
          include: {
            user: {
              select: { id: true, username: true, displayName: true, role: true },
            },
          },
        },
      },
    });

    if (!event) {
      throw new AppError('事件不存在', 404);
    }
    if (!isResearchTierAllowed(event.isResearchTier, userRole)) {
      throw new AppError('无权访问', 403);
    }

    const visibleAnalyses = filterAnalysesByRole(
      event.analyses,
      userRole,
      userId
    );
    const analysisVisibility = getAnalysisVisibilityCounts(
      event.analyses,
      userRole
    );

    const visibleSightings = event.sightings
      .filter((s: any) => isResearchTierAllowed(s.contentTier, userRole))
      .map((s: any) => {
        const { contentTier, ...rest } = s;
        return rest;
      });

    const displayTitle =
      event.isResearchTier === 'public' ||
      (userRole && userRole !== 'PUBLIC')
        ? event.title
        : '【权限受限事件】';

    const displaySummary =
      event.isResearchTier === 'public' ||
      (userRole && userRole !== 'PUBLIC')
        ? event.summary
        : '此事件为研究级或专家级内容，需要更高权限才能查看详细信息。';

    const displayDescription =
      event.isResearchTier === 'public' ||
      (userRole && userRole !== 'PUBLIC')
        ? event.description
        : null;

    const eventWithCount = {
      ...event,
      title: displayTitle,
      summary: displaySummary,
      description: displayDescription,
      sightingCount: visibleSightings.length,
      sightings: visibleSightings,
      analyses: visibleAnalyses,
      analysisMeta: analysisVisibility,
    };

    res.json({ success: true, data: eventWithCount });
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
          create: [{ userId: req.user!.id, role: 'creator' }],
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
      data: { eventId: req.params.id, userId, role },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
      },
    });

    await addContribution(userId, 'EVENT_COLLABORATOR', 15);

    res.status(201).json({ success: true, data: collab });
  })
);

router.get(
  '/events/:id/summary',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const userId = req.user?.id;

    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        sightings: {
          select: {
            id: true,
            title: true,
            description: true,
            occurredAt: true,
            latitude: true,
            longitude: true,
            witnessCount: true,
            credibilityScore: true,
            credibilityLevel: true,
            status: true,
            contentTier: true,
            media: true,
          },
        },
        analyses: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                role: true,
              },
            },
          },
        },
        collaborators: true,
        tags: true,
      },
    });

    if (!event) {
      throw new AppError('事件不存在', 404);
    }

    if (!isResearchTierAllowed(event.isResearchTier, userRole)) {
      throw new AppError('无权访问此分级事件', 403);
    }

    const visibleAnalyses = filterAnalysesByRole(
      event.analyses,
      userRole,
      userId
    );

    const visibleSightings = event.sightings.filter((s: any) =>
      isResearchTierAllowed(s.contentTier, userRole)
    );

    const actualSightingCount = visibleSightings.length;

    const avgCredibility =
      actualSightingCount > 0
        ? visibleSightings.reduce(
            (s: number, x: any) => s + x.credibilityScore,
            0
          ) / actualSightingCount
        : 0;

    const dates = visibleSightings
      .map((s: any) => new Date(s.occurredAt).getTime())
      .sort();
    const timeRange =
      dates.length > 1
        ? {
            start: new Date(dates[0]).toISOString(),
            end: new Date(dates[dates.length - 1]).toISOString(),
            durationHours: Math.round(
              (dates[dates.length - 1] - dates[0]) / 3600000
            ),
          }
        : null;

    const mediaCount = visibleSightings.reduce(
      (s: number, x: any) => s + x.media.length,
      0
    );
    const totalWitnesses = visibleSightings.reduce(
      (s: number, x: any) => s + x.witnessCount,
      0
    );

    const displayTitle = event.isResearchTier !== 'public'
      ? userRole && userRole !== 'PUBLIC'
        ? event.title
        : '【权限受限事件】'
      : event.title;

    const displaySummary = event.isResearchTier !== 'public'
      ? userRole && userRole !== 'PUBLIC'
        ? event.summary || '（暂无摘要）'
        : '此事件为研究级或专家级内容，需要更高权限才能查看详细信息。'
      : event.summary || '（暂无摘要）';

    const generatedSummary = `
【事件摘要】${displayTitle}
${displaySummary}

【统计】
- 关联报告数量：${actualSightingCount} 份
- 平均可信度：${avgCredibility.toFixed(1)} / 100
- 总目击人数：${totalWitnesses} 人
- 媒体证据：${mediaCount} 份
- 参与协作：${event.collaborators.length} 人
- 可见分析结论：${visibleAnalyses.length} 条
${timeRange ? `- 时间跨度：${timeRange.durationHours} 小时 (${timeRange.start} ~ ${timeRange.end})` : ''}

【标签】${event.tags.map((t: any) => '#' + t.tag).join(' ')}
`.trim();

    res.json({
      success: true,
      data: {
        eventId: event.id,
        title: displayTitle,
        generatedSummary,
        stats: {
          sightingCount: actualSightingCount,
          avgCredibility,
          totalWitnesses,
          mediaCount,
          collaboratorCount: event.collaborators.length,
          analysisCount: visibleAnalyses.length,
          timeRange,
        },
      },
    });
  })
);

export { router as analysisRoutes };
