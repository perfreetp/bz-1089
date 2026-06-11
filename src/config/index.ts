import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadSize: 50 * 1024 * 1024,
  defaultCredibilityScore: 20,
  duplicateDistanceThresholdKm: 5,
  duplicateTimeThresholdHours: 48,
  duplicateMinSimilarity: 0.6,
};
