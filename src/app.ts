import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authRoutes } from './routes/auth';
import { sightingRoutes } from './routes/sighting';
import { mediaRoutes } from './routes/media';
import { analysisRoutes } from './routes/analysis';
import { duplicateRoutes } from './routes/duplicate';
import { reviewRoutes } from './routes/review';
import { notificationRoutes } from './routes/notification';
import { statsRoutes } from './routes/stats';

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (data: any) => {
    const bigIntReplacer = (_key: string, value: any) =>
      typeof value === 'bigint' ? Number(value) : value;
    const json = JSON.stringify(data, bigIntReplacer);
    res.setHeader('Content-Type', 'application/json');
    res.send(json);
    return res;
  };
  next();
});

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
app.use('/uploads', express.static(config.uploadDir));

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      name: '外星人发现后端服务',
      modules: [
        '线索提交',
        '媒体上传',
        '重复检测',
        '可信度评分',
        '事件聚合',
        '用户协作',
        '通知',
        '统计',
      ],
    },
  });
});

app.get('/api/docs', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: '外星人发现后端 API',
      version: '1.0.0',
      baseUrl: '/api',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me (需要令牌)',
        updateMe: 'PUT /api/auth/me (需要令牌)',
        listUsers: 'GET /api/auth/users (专家/管理员)',
        setRole: 'PUT /api/auth/users/role (管理员)',
      },
      sightings: {
        create: 'POST /api/sightings (需要令牌)',
        list: 'GET /api/sightings (公开查询，支持筛选：经纬度/半径/日期/分类/可信度)',
        nearby: 'GET /api/sightings/nearby?lat=&lon=&radiusKm=',
        detail: 'GET /api/sightings/:id',
        markFalse: 'PUT /api/sightings/:id/false-positive',
        delete: 'DELETE /api/sightings/:id',
      },
      media: {
        upload: 'POST /api/media/upload/:sightingId (multipart/form-data: files[])',
        list: 'GET /api/media/sighting/:sightingId',
        delete: 'DELETE /api/media/:id',
      },
      analysis: {
        addAnalysis: 'POST /api/analyses (追加分析结论)',
        listAnalyses: 'GET /api/sightings/:sightingId/analyses',
        listEvents: 'GET /api/events',
        getEvent: 'GET /api/events/:id',
        createEvent: 'POST /api/events (研究员/专家/管理员)',
        addCollaborator: 'POST /api/events/:id/collaborators',
        eventSummary: 'GET /api/events/:id/summary',
      },
      duplicateDetection: {
        detect: 'POST /api/duplicates/detect/:sightingId?radiusKm=&timeHours=&minSimilarity=',
        report: 'POST /api/duplicates/report (举报重复)',
        listReports: 'GET /api/duplicates/reports (专家)',
        merge: 'POST /api/duplicates/merge/:reportId (专家/管理员 - 合并相似报告)',
        recalculateCred: 'PUT /api/duplicates/:sightingId/credibility/recalculate',
      },
      reviewsAndTasks: {
        requestReview: 'POST /api/reviews (申请专家复核)',
        listReviews: 'GET /api/reviews (专家/研究员)',
        getReview: 'GET /api/reviews/:id',
        addReviewComment: 'POST /api/reviews/:id/comments (记录复核意见)',
        completeReview: 'POST /api/reviews/:id/complete (专家 - 完成复核)',
        createTask: 'POST /api/tasks (创建小组任务)',
        listTasks: 'GET /api/tasks?mine=true (拉取小组任务)',
        updateTaskStatus: 'PUT /api/tasks/:id/status',
        assignTask: 'PUT /api/tasks/:id/assign',
      },
      notifications: {
        createSubscription: 'POST /api/subscriptions (订阅区域预警)',
        listSubscriptions: 'GET /api/subscriptions',
        deleteSubscription: 'DELETE /api/subscriptions/:id',
        listNotifications: 'GET /api/notifications',
        markRead: 'PUT /api/notifications/read (支持 ids 数组或全部标记为已读)',
      },
      stats: {
        dashboard: 'GET /api/stats/dashboard',
        heatmap: 'GET /api/stats/heatmap?minLat=&maxLat=&minLon=&maxLon=&cellSizeKm=',
        leaderboard: 'GET /api/stats/leaderboard?period=all|week|month',
        regionStats: 'GET /api/stats/region-stats?lat=&lon=&radiusKm=',
        export: 'GET /api/stats/export-metadata (研究员/专家)',
      },
      userRoles: {
        PUBLIC: '公开版：提交/查看公开数据',
        RESEARCHER: '研究版：可访问研究级内容、创建事件、分配任务',
        EXPERT: '专家版：复核、合并、可信度评分、全部权限',
        ADMIN: '管理员：全局管理、角色分配',
      },
      contentTier: {
        public: '公开级，所有用户可见',
        research: '研究级，研究员及以上可见',
        expert: '专家级，仅专家及以上可见',
      },
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/sightings', sightingRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api', analysisRoutes);
app.use('/api/duplicates', duplicateRoutes);
app.use('/api', reviewRoutes);
app.use('/api', notificationRoutes);
app.use('/api/stats', statsRoutes);

app.use(notFound);
app.use(errorHandler);

export { app };
