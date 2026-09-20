import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export const config = Object.freeze({
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  storageDir: process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.join(rootDir, 'storage'),
  port: positiveNumber(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionTtlMs: positiveNumber(process.env.SESSION_HOURS, 8) * 60 * 60 * 1000,
  maxUploadBytes: positiveNumber(process.env.MAX_UPLOAD_MB, 50) * 1024 * 1024,
  backupRetention: Math.floor(positiveNumber(process.env.BACKUP_RETENTION, 30)),
  maxBackupBytes: positiveNumber(process.env.MAX_BACKUP_MB, 512) * 1024 * 1024,
});
