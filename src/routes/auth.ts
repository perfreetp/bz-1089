import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { protect, requireRoles, UserRole } from '../middleware/auth';
import { registerSchema, loginSchema, updateUserRoleSchema } from '../validations/schemas';

const router = Router();

router.post(
  '/register',
  asyncHandler(async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: data.username }, { email: data.email }],
      },
    });

    if (existing) {
      res.status(400);
      throw new Error('用户名或邮箱已存在');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash,
        displayName: data.displayName || data.username,
        role: 'PUBLIC',
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.status(201).json({
      success: true,
      data: { user, token },
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: data.usernameOrEmail }, { email: data.usernameOrEmail }],
      },
    });

    if (!user) {
      res.status(401);
      throw new Error('用户名或密码错误');
    }

    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      res.status(401);
      throw new Error('用户名或密码错误');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          avatarUrl: user.avatarUrl,
          reputation: user.reputation,
          contributionPoints: user.contributionPoints,
        },
        token,
      },
    });
  })
);

router.get(
  '/me',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        bio: true,
        avatarUrl: true,
        reputation: true,
        contributionPoints: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404);
      throw new Error('用户不存在');
    }

    res.json({ success: true, data: user });
  })
);

router.put(
  '/me',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const { displayName, bio, avatarUrl } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        displayName: displayName || undefined,
        bio: bio || undefined,
        avatarUrl: avatarUrl || undefined,
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        bio: true,
        avatarUrl: true,
        reputation: true,
        contributionPoints: true,
      },
    });

    res.json({ success: true, data: user });
  })
);

router.get(
  '/users',
  protect,
  requireRoles('ADMIN', 'EXPERT'),
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const role = req.query.role as UserRole | undefined;

    const where: any = role ? { role } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          email: true,
          reputation: true,
          contributionPoints: true,
          createdAt: true,
        },
        orderBy: { contributionPoints: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  })
);

router.put(
  '/users/role',
  protect,
  requireRoles('ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = updateUserRoleSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
      },
    });

    res.json({ success: true, data: user });
  })
);

export { router as authRoutes };
