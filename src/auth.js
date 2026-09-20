import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';

const sessions = new Map();
const attempts = new Map();
const COOKIE_NAME = 'docs_session';
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
let lastAttemptCleanup = 0;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
}

function digestToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, (error, value) => error ? reject(error) : resolve(value.toString('hex'))));
}

async function verifyPassword(password) {
  if (config.adminPasswordHash) {
    const [algorithm, salt, expected] = config.adminPasswordHash.split(':');
    if (algorithm !== 'scrypt' || !salt || !expected) return false;
    const actual = await derivePassword(password, salt);
    return safeEqual(actual, expected);
  }

  if (config.nodeEnv !== 'production' && config.adminPassword) {
    return safeEqual(password, config.adminPassword);
  }

  return false;
}

function cookie(value, maxAge) {
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  if (now - lastAttemptCleanup >= ATTEMPT_WINDOW_MS) {
    for (const [attemptKey, attempt] of attempts) {
      if (now - attempt.startedAt > ATTEMPT_WINDOW_MS) attempts.delete(attemptKey);
    }
    lastAttemptCleanup = now;
  }
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 0, startedAt: now });
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) throw new AppError(429, 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.');
}

function noteFailure(req) {
  const key = clientKey(req);
  const entry = attempts.get(key) || { count: 0, startedAt: Date.now() };
  entry.count += 1;
  attempts.set(key, entry);
}

export async function login(req, res) {
  checkRateLimit(req);
  if (config.cookieSecure && !req.secure) throw new AppError(400, 'Login aman memerlukan HTTPS karena COOKIE_SECURE aktif. Buka alamat HTTPS atau nonaktifkan COOKIE_SECURE hanya untuk pengembangan lokal.');
  const username = typeof req.body.username === 'string' ? req.body.username : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const usernameMatches = safeEqual(username, config.adminUsername);
  const passwordMatches = await verifyPassword(password);

  if (!usernameMatches || !passwordMatches) {
    noteFailure(req);
    throw new AppError(401, 'Username atau password salah.');
  }

  attempts.delete(clientKey(req));
  const rawToken = randomBytes(32).toString('base64url');
  const session = {
    username,
    csrfToken: randomBytes(24).toString('base64url'),
    expiresAt: Date.now() + config.sessionTtlMs,
  };
  sessions.set(digestToken(rawToken), session);
  res.setHeader('Set-Cookie', cookie(rawToken, Math.floor(config.sessionTtlMs / 1000)));
  return session;
}

export function getSession(req) {
  const rawToken = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!rawToken) return null;
  const key = digestToken(rawToken);
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  return session;
}

export function requireAuth(req, _res, next) {
  const session = getSession(req);
  if (!session) return next(new AppError(401, 'Silakan login terlebih dahulu.'));
  req.session = session;
  next();
}

export function requireCsrf(req, _res, next) {
  const token = req.get('x-csrf-token') || '';
  if (!safeEqual(token, req.session?.csrfToken || '')) return next(new AppError(403, 'Token keamanan tidak valid. Muat ulang halaman.'));
  next();
}

export function logout(req, res) {
  const rawToken = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (rawToken) sessions.delete(digestToken(rawToken));
  res.setHeader('Set-Cookie', cookie('', 0));
}

export function authConfigured() {
  return Boolean(config.adminPasswordHash || (config.nodeEnv !== 'production' && config.adminPassword));
}
