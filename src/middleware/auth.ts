import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import { config } from '../config';
import { prisma } from '../lib/prisma';

export type UserRole = 'PUBLIC' | 'RESEARCHER' | 'EXPERT' | 'ADMIN';

interface JwtPayload {
  id: string;
  username: string;
  role: UserRole;
}

export const protect = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      _res.status(401);
      throw new Error('未授权，缺少令牌');
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, role: true, username: true },
      });

      if (!user) {
        _res.status(401);
        throw new Error('用户不存在');
      }

      req.user = { id: user.id, role: user.role as UserRole, username: user.username };
      next();
    } catch {
      _res.status(401);
      throw new Error('令牌无效或已过期');
    }
  }
);

export const optionalAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { id: true, role: true, username: true },
        });
        if (user) req.user = { id: user.id, role: user.role as UserRole, username: user.username };
      } catch {
      }
    }
    next();
  }
);

export const requireRoles = (...roles: UserRole[]) => {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!_req.user) {
      res.status(401);
      throw new Error('未授权');
    }
    if (!roles.includes(_req.user.role)) {
      res.status(403);
      throw new Error(`权限不足，需要角色: ${roles.join(', ')}`);
    }
    next();
  };
};

export const isResearchTierAllowed = (contentTier: string, userRole?: UserRole): boolean => {
  if (contentTier === 'public') return true;
  if (contentTier === 'research') {
    return userRole === 'RESEARCHER' || userRole === 'EXPERT' || userRole === 'ADMIN';
  }
  return userRole === 'EXPERT' || userRole === 'ADMIN';
};
