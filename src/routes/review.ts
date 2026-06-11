import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { protect, requireRoles } from '../middleware/auth';
import {
  createReviewRequestSchema,
  reviewCommentSchema,
  reviewCompleteSchema,
  createTaskSchema,
  updateTaskStatusSchema,
} from '../validations/schemas';
import {
  calculateCredibilityLevel,
  updateCredibilityOnReview,
} from '../utils/credibility';
import { addContribution, createNotification } from '../services/notificationService';

type SightingStatus = 'PENDING' | 'VERIFIED' | 'DISPROVED' | 'MERGED' | 'INVESTIGATING';
type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';

const router = Router();

router.post(
  '/reviews',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = createReviewRequestSchema.parse(req.body);
    const requesterRole = req.user!.role;

    const sighting = await prisma.sighting.findUnique({
      where: { id: data.sightingId },
    });
    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    if (
      sighting.userId !== req.user!.id &&
      requesterRole === 'PUBLIC'
    ) {
      res.status(403);
      throw new Error('无权申请复核此记录');
    }

    let reviewerId = data.reviewerId;
    if (!reviewerId) {
      const expert = await prisma.user.findFirst({
        where: { role: { in: ['EXPERT', 'RESEARCHER'] } },
        orderBy: [{ reputation: 'desc' }],
        select: { id: true },
      });
      reviewerId = expert?.id;
    }

    const reviewRequest = await prisma.reviewRequest.create({
      data: {
        sightingId: data.sightingId,
        requesterId: req.user!.id,
        reviewerId,
        priority: data.priority || 'normal',
        notes: data.notes,
        status: 'PENDING',
      },
      include: {
        sighting: { select: { id: true, title: true } },
        reviewer: { select: { id: true, username: true, displayName: true } },
        requester: { select: { id: true, username: true, displayName: true } },
      },
    });

    if (reviewerId) {
      await createNotification({
        userId: reviewerId,
        type: 'REVIEW_REQUESTED' as NotificationType,
        title: '收到专家复核申请',
        message: `需要复核的观测：${sighting.title}`,
        relatedSightingId: data.sightingId,
      });
    }

    await addContribution(req.user!.id, 'REQUEST_REVIEW', 10, data.sightingId);

    res.status(201).json({ success: true, data: reviewRequest });
  })
);

router.get(
  '/reviews',
  protect,
  requireRoles('EXPERT', 'RESEARCHER', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as SightingStatus | undefined;
    const mine = req.query.mine === 'true';

    const where: any = {
      ...(status ? { status } : {}),
      ...(mine ? { reviewerId: req.user!.id } : {}),
    };

    const [reviews, total] = await Promise.all([
      prisma.reviewRequest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sighting: {
            select: {
              id: true, title: true, occurredAt: true, locationName: true,
              latitude: true, longitude: true, credibilityScore: true,
            },
          },
          requester: { select: { id: true, username: true, displayName: true } },
          reviewer: { select: { id: true, username: true, displayName: true } },
          _count: { select: { comments: true } },
        },
        orderBy: [{ priority: 'desc' }, { assignedAt: 'asc' }],
      }),
      prisma.reviewRequest.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  })
);

router.get(
  '/reviews/:id',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const review = await prisma.reviewRequest.findUnique({
      where: { id: req.params.id },
      include: {
        sighting: { include: { media: { take: 3 } } },
        requester: { select: { id: true, username: true, displayName: true } },
        reviewer: { select: { id: true, username: true, displayName: true } },
        comments: {
          include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!review) {
      res.status(404);
      throw new Error('复核请求不存在');
    }

    if (
      review.requesterId !== req.user!.id &&
      review.reviewerId !== req.user!.id &&
      !['ADMIN', 'EXPERT'].includes(req.user!.role)
    ) {
      res.status(403);
      throw new Error('无权访问此复核请求');
    }

    res.json({ success: true, data: review });
  })
);

router.post(
  '/reviews/:id/comments',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = reviewCommentSchema.parse(req.body);

    const review = await prisma.reviewRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!review) {
      res.status(404);
      throw new Error('复核请求不存在');
    }

    const comment = await prisma.reviewComment.create({
      data: {
        reviewRequestId: req.params.id,
        userId: req.user!.id,
        content: data.content,
        recommendation: data.recommendation,
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, role: true } },
      },
    });

    await addContribution(
      req.user!.id,
      'REVIEW_COMMENT',
      5,
      review.sightingId
    );

    const notifiedUsers = [review.requesterId, review.reviewerId].filter(
      (id): id is string => !!id && id !== req.user!.id
    );
    for (const uid of [...new Set(notifiedUsers)]) {
      await createNotification({
        userId: uid,
        type: 'REVIEW_REQUESTED' as NotificationType,
        title: '复核请求有新评论',
        message: `来自 ${req.user!.username} 的复核意见`,
        relatedSightingId: review.sightingId,
      });
    }

    res.status(201).json({ success: true, data: comment });
  })
);

router.post(
  '/reviews/:id/complete',
  protect,
  requireRoles('EXPERT', 'RESEARCHER', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = reviewCompleteSchema.parse(req.body);

    const review = await prisma.reviewRequest.findUnique({
      where: { id: req.params.id },
      include: { sighting: true },
    });

    if (!review) {
      res.status(404);
      throw new Error('复核请求不存在');
    }

    if (
      review.reviewerId !== req.user!.id &&
      !['ADMIN', 'EXPERT'].includes(req.user!.role)
    ) {
      res.status(403);
      throw new Error('无权完成此复核');
    }

    const isVerified = data.status === 'VERIFIED';
    const newCredScore = updateCredibilityOnReview(
      review.sighting.credibilityScore,
      isVerified
    );

    const [updatedReview, updatedSighting] = await prisma.$transaction([
      prisma.reviewRequest.update({
        where: { id: req.params.id },
        data: {
          status: data.status,
          completedAt: new Date(),
        },
      }),
      prisma.sighting.update({
        where: { id: review.sightingId },
        data: {
          status: data.status as SightingStatus,
          credibilityScore: newCredScore,
          credibilityLevel: calculateCredibilityLevel(newCredScore),
          isFalsePositive: data.status === 'DISPROVED',
        },
      }),
    ]);

    if (data.finalComment) {
      await prisma.reviewComment.create({
        data: {
          reviewRequestId: req.params.id,
          userId: req.user!.id,
          content: data.finalComment,
          recommendation: data.status,
        },
      });
    }

    await addContribution(
      req.user!.id,
      'COMPLETE_REVIEW',
      30,
      review.sightingId
    );

    if (review.requesterId !== req.user!.id) {
      await createNotification({
        userId: review.requesterId,
        type: 'REVIEW_COMPLETED' as NotificationType,
        title: '您申请的复核已完成',
        message: `复核结论：${data.status} — ${review.sighting.title}`,
        relatedSightingId: review.sightingId,
      });
    }

    res.json({
      success: true,
      data: { review: updatedReview, sighting: updatedSighting },
    });
  })
);

router.post(
  '/tasks',
  protect,
  requireRoles('EXPERT', 'RESEARCHER', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = createTaskSchema.parse(req.body);

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        eventId: data.eventId,
        sightingId: data.sightingId,
        creatorId: req.user!.id,
        assigneeId: data.assigneeId,
        priority: data.priority || 'medium',
        dueDate: data.dueDate,
      },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        assignee: { select: { id: true, username: true, displayName: true } },
        sighting: data.sightingId ? { select: { id: true, title: true } } : false,
        event: data.eventId ? { select: { id: true, title: true } } : false,
      },
    });

    if (data.assigneeId && data.assigneeId !== req.user!.id) {
      await createNotification({
        userId: data.assigneeId,
        type: 'TASK_ASSIGNED' as NotificationType,
        title: '您被分配了一项协作任务',
        message: `任务：${data.title}`,
        relatedSightingId: data.sightingId,
        relatedEventId: data.eventId,
      });
    }

    await addContribution(req.user!.id, 'CREATE_TASK', 20);

    res.status(201).json({ success: true, data: task });
  })
);

router.get(
  '/tasks',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const mine = req.query.mine === 'true';
    const status = req.query.status as string | undefined;

    const where: any = {
      ...(status ? { status } : {}),
      ...(mine ? { assigneeId: req.user!.id } : {}),
    };

    if (mine || ['EXPERT', 'RESEARCHER', 'ADMIN'].includes(req.user!.role)) {
      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            creator: { select: { id: true, username: true, displayName: true } },
            assignee: { select: { id: true, username: true, displayName: true } },
            sighting: { select: { id: true, title: true } },
            event: { select: { id: true, title: true } },
          },
          orderBy: [
            { status: 'asc' },
            { priority: 'desc' },
            { dueDate: 'asc' },
            { createdAt: 'desc' },
          ],
        }),
        prisma.task.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          tasks,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
      });
    } else {
      res.status(403);
      throw new Error('无权访问任务列表');
    }
  })
);

router.put(
  '/tasks/:id/status',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const data = updateTaskStatusSchema.parse(req.body);

    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
    });

    if (!task) {
      res.status(404);
      throw new Error('任务不存在');
    }

    if (
      task.assigneeId !== req.user!.id &&
      task.creatorId !== req.user!.id &&
      req.user!.role !== 'ADMIN'
    ) {
      res.status(403);
      throw new Error('无权更新此任务状态');
    }

    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
      include: {
        creator: { select: { id: true, username: true } },
        assignee: { select: { id: true, username: true } },
      },
    });

    if (data.status === 'COMPLETED' && task.assigneeId) {
      await addContribution(task.assigneeId, 'COMPLETE_TASK', 25);
    }

    res.json({ success: true, data: updated });
  })
);

router.put(
  '/tasks/:id/assign',
  protect,
  requireRoles('EXPERT', 'RESEARCHER', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { assigneeId } = req.body;

    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
    });

    if (!task) {
      res.status(404);
      throw new Error('任务不存在');
    }

    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: { assigneeId },
      include: {
        assignee: { select: { id: true, username: true, displayName: true } },
      },
    });

    if (assigneeId && assigneeId !== req.user!.id) {
      await createNotification({
        userId: assigneeId,
        type: 'TASK_ASSIGNED' as NotificationType,
        title: '新任务已分配给您',
        message: `任务：${task.title}`,
        relatedSightingId: task.sightingId || undefined,
        relatedEventId: task.eventId || undefined,
      });
    }

    res.json({ success: true, data: updated });
  })
);

export { router as reviewRoutes };
