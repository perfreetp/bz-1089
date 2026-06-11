import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { protect, isResearchTierAllowed } from '../middleware/auth';
import { calculateInitialCredibility, calculateCredibilityLevel } from '../utils/credibility';
import { addContribution } from '../services/notificationService';

const router = Router();

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadSize },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp',
      '.mp4', '.avi', '.mov', '.mkv', '.webm',
      '.wav', '.mp3', '.flac',
      '.pdf', '.txt', '.csv', '.json',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`不支持的文件类型: ${ext}`));
  },
});

function getMediaType(ext: string): 'image' | 'video' | 'audio' | 'document' {
  const images = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const videos = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
  const audios = ['.wav', '.mp3', '.flac'];
  if (images.includes(ext)) return 'image';
  if (videos.includes(ext)) return 'video';
  if (audios.includes(ext)) return 'audio';
  return 'document';
}

router.post(
  '/upload/:sightingId',
  protect,
  upload.array('files', 10),
  asyncHandler(async (req: Request, res: Response) => {
    const { sightingId } = req.params;

    const sighting = await prisma.sighting.findUnique({
      where: { id: sightingId },
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
      throw new Error('无权为此记录上传媒体');
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400);
      throw new Error('没有上传文件');
    }

    const mediaRecords = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const type = getMediaType(ext);
      const record = await prisma.media.create({
        data: {
          sightingId,
          type,
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          storagePath: file.path,
          metadata: JSON.stringify({ encoding: file.encoding }),
        },
      });
      mediaRecords.push(record);
    }

    if (mediaRecords.length > 0 && sighting.credibilityScore < 60) {
      const newScore = Math.min(
        100,
        sighting.credibilityScore + 10 * mediaRecords.length
      );
      await prisma.sighting.update({
        where: { id: sightingId },
        data: {
          credibilityScore: newScore,
          credibilityLevel: calculateCredibilityLevel(newScore),
        },
      });
    }

    await addContribution(
      req.user!.id,
      'UPLOAD_MEDIA',
      20 * mediaRecords.length,
      sightingId
    );

    res.status(201).json({
      success: true,
      data: { count: mediaRecords.length, media: mediaRecords },
    });
  })
);

router.get(
  '/sighting/:sightingId',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const userRole = req.user?.role;

    const sighting = await prisma.sighting.findUnique({
      where: { id: req.params.sightingId },
      select: { contentTier: true, userId: true },
    });

    if (!sighting) {
      res.status(404);
      throw new Error('观测记录不存在');
    }

    if (!isResearchTierAllowed(sighting.contentTier, userRole)) {
      res.status(403);
      throw new Error('无权访问此分级内容');
    }

    const media = await prisma.media.findMany({
      where: { sightingId: req.params.sightingId },
      orderBy: { uploadedAt: 'desc' },
    });

    res.json({ success: true, data: media });
  })
);

router.delete(
  '/:id',
  protect,
  asyncHandler(async (req: Request, res: Response) => {
    const media = await prisma.media.findUnique({
      where: { id: req.params.id },
      include: { sighting: true },
    });

    if (!media) {
      res.status(404);
      throw new Error('媒体记录不存在');
    }

    if (
      media.sighting.userId !== req.user!.id &&
      req.user!.role !== 'ADMIN'
    ) {
      res.status(403);
      throw new Error('无权删除此媒体');
    }

    try {
      if (fs.existsSync(media.storagePath)) {
        fs.unlinkSync(media.storagePath);
      }
      if (media.thumbnailPath && fs.existsSync(media.thumbnailPath)) {
        fs.unlinkSync(media.thumbnailPath);
      }
    } catch (e) {
    }

    await prisma.media.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: '媒体已删除' });
  })
);

export { router as mediaRoutes };
