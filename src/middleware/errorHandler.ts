import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { config } from '../config';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new AppError(`找不到资源 - ${req.originalUrl}`, 404);
  next(error);
};

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || '服务器内部错误';

  if (err instanceof ZodError) {
    statusCode = 400;
    const errors = err.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(statusCode).json({
      success: false,
      error: '验证失败',
      details: errors,
    });
  }

  if (err.code === 'P2002') {
    statusCode = 400;
    message = '数据已存在，违反唯一约束';
  }
  if (err.code === 'P2025') {
    statusCode = 404;
    message = '记录不存在';
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined,
  });
};
