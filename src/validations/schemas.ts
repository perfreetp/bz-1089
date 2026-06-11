import { z } from 'zod';

export type UfoCategory = 'DISC' | 'SPHERE' | 'TRIANGLE' | 'CYLINDER' | 'LIGHT' | 'ORB' | 'OTHER';
const ufoCategoryEnum = z.enum(['DISC', 'SPHERE', 'TRIANGLE', 'CYLINDER', 'LIGHT', 'ORB', 'OTHER']);

export const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  displayName: z.string().optional(),
});

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
});

export const createSightingSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().min(10),
  category: ufoCategoryEnum.optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  locationName: z.string().optional(),
  occurredAt: z.coerce.date(),
  durationSeconds: z.coerce.number().int().positive().optional(),
  witnessCount: z.coerce.number().int().positive().optional(),
  weatherConditions: z.string().optional(),
  isAnonymous: z.boolean().optional(),
  contentTier: z.enum(['public', 'research', 'expert']).optional(),
  tags: z.array(z.string().min(1).max(30)).max(10).optional(),
});

export const querySightingsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  radiusKm: z.coerce.number().positive().optional(),
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLon: z.coerce.number().optional(),
  maxLon: z.coerce.number().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  category: ufoCategoryEnum.optional(),
  status: z.string().optional(),
  minCredibility: z.coerce.number().min(0).max(100).optional(),
  maxCredibility: z.coerce.number().min(0).max(100).optional(),
  userId: z.string().optional(),
  eventId: z.string().optional(),
  isFalsePositive: z.coerce.boolean().optional(),
  contentTier: z.enum(['public', 'research']).optional(),
  sortBy: z.enum(['occurredAt', 'credibility', 'createdAt']).optional().default('occurredAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  search: z.string().optional(),
});

export const createAnalysisSchema = z.object({
  sightingId: z.string().optional(),
  eventId: z.string().optional(),
  content: z.string().min(5),
  confidence: z.coerce.number().min(0).max(1).optional(),
  isResearch: z.boolean().optional(),
});

export const reportDuplicateSchema = z.object({
  sourceSightingId: z.string(),
  duplicateSightingId: z.string(),
  similarityScore: z.coerce.number().min(0).max(1).optional(),
});

export const mergeSightingsSchema = z.object({
  targetEventId: z.string().optional(),
  eventTitle: z.string().min(2).optional(),
  eventSummary: z.string().optional(),
});

export const markFalsePositiveSchema = z.object({
  reason: z.string().optional(),
});

export const createReviewRequestSchema = z.object({
  sightingId: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  notes: z.string().optional(),
  reviewerId: z.string().optional(),
});

export const reviewCommentSchema = z.object({
  content: z.string().min(1),
  recommendation: z.enum(['VERIFY', 'DISPROVE', 'MERGE', 'INVESTIGATE', 'PENDING']).optional(),
});

export const reviewCompleteSchema = z.object({
  status: z.enum(['VERIFIED', 'DISPROVED', 'MERGED', 'INVESTIGATING', 'PENDING']),
  finalComment: z.string().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  eventId: z.string().optional(),
  sightingId: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.coerce.date().optional(),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});

export const createSubscriptionSchema = z.object({
  type: z.enum(['region', 'general', 'research']),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().optional(),
  regionName: z.string().optional(),
  minCredibility: z.coerce.number().min(0).max(100).optional(),
});

export const updateUserRoleSchema = z.object({
  userId: z.string(),
  role: z.enum(['PUBLIC', 'RESEARCHER', 'EXPERT', 'ADMIN']),
});

export const createEventSchema = z.object({
  title: z.string().min(2).max(200),
  summary: z.string().optional(),
  description: z.string().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  isResearchTier: z.enum(['public', 'research']).optional(),
  tags: z.array(z.string()).optional(),
});

export const heatmapQuerySchema = z.object({
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLon: z.coerce.number().optional(),
  maxLon: z.coerce.number().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  minCredibility: z.coerce.number().min(0).max(100).optional(),
  cellSizeKm: z.coerce.number().positive().optional().default(1),
});
