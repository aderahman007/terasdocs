import express from 'express';
import path from 'node:path';
import { streamTarGzip } from './archive.js';
import { authConfigured, getSession, login, logout, requireAuth, requireCsrf } from './auth.js';
import { config } from './config.js';
import { AppError } from './errors.js';
import { renderMarkdown } from './markdown.js';
import {
  createDocument,
  createFullBackup,
  createMedia,
  createProject,
  createSection,
  deleteBackup,
  deleteDocument,
  deleteMedia,
  deleteUnusedMedia,
  deleteProject,
  deleteSection,
  discardRestore,
  getBackup,
  getCatalog,
  getDocument,
  getMediaForViewer,
  getMediaInventory,
  getNavigation,
  getProjects,
  initializeStorage,
  inspectRestore,
  listBackups,
  reorderCatalog,
  restoreBackup,
  searchDocuments,
  updateDocument,
  updateProject,
  updateSection,
} from './storage.js';

await initializeStorage();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(['/api/auth', '/api/admin'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/public', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  next();
});

const viewerOptions = (req) => ({ includePrivate: Boolean(getSession(req)) });

app.get('/api/public/catalog', async (req, res) => res.json(await getCatalog(viewerOptions(req))));
app.get('/api/public/projects', async (req, res) => res.json(await getProjects(viewerOptions(req))));
app.get('/api/public/projects/:slug/navigation', async (req, res) => res.json(await getNavigation(req.params.slug, viewerOptions(req))));
app.get('/api/public/search', async (req, res) => res.json(await searchDocuments(req.query.q, viewerOptions(req))));
app.get('/api/public/documents/:id', async (req, res) => {
  const document = await getDocument(req.params.id, viewerOptions(req));
  res.json({ ...document, html: renderMarkdown(document.content), content: undefined });
});
app.get('/media/:id', async (req, res) => {
  const authenticated = Boolean(getSession(req));
  const media = await getMediaForViewer(req.params.id, { authenticated });
  const inline = ['image', 'video', 'pdf'].includes(media.kind);
  const fallbackName = media.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Vary', 'Cookie');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(media.originalName)}`);
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; sandbox");
  res.sendFile(media.filePath);
});

app.post('/api/auth/login', async (req, res) => {
  if (!authConfigured()) throw new AppError(503, 'Akun admin belum dikonfigurasi pada server.');
  const session = await login(req, res);
  res.json({ user: { username: session.username }, csrfToken: session.csrfToken });
});
app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Belum login.' });
  res.json({ user: { username: session.username }, csrfToken: session.csrfToken });
});
app.post('/api/auth/logout', requireAuth, requireCsrf, (req, res) => {
  logout(req, res);
  res.status(204).end();
});

const admin = express.Router();
admin.use(requireAuth);
admin.get('/catalog', async (_req, res) => res.json(await getCatalog({ admin: true })));
admin.get('/media', async (_req, res) => res.json({ ...await getMediaInventory(), maxUploadBytes: config.maxUploadBytes }));
admin.get('/backups', async (_req, res) => res.json({ items: await listBackups(), retention: config.backupRetention, maxRestoreBytes: config.maxBackupBytes }));
admin.get('/backups/:id/download', async (req, res) => {
  const backup = await getBackup(req.params.id);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${backup.id}.tar.gz"`);
  await streamTarGzip(backup.directory, res);
});
admin.get('/documents/:id', async (req, res) => res.json(await getDocument(req.params.id, { admin: true })));
admin.use(requireCsrf);
admin.post('/backups', async (_req, res) => res.status(201).json(await createFullBackup()));
admin.post('/backups/restore/inspect', async (req, res) => res.json(await inspectRestore(req)));
admin.post('/backups/restore/apply', async (req, res) => res.json(await restoreBackup(req.body?.token)));
admin.delete('/backups/restore/:token', async (req, res) => res.json(await discardRestore(req.params.token)));
admin.delete('/backups/:id', async (req, res) => res.json(await deleteBackup(req.params.id)));
admin.post('/preview', (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.slice(0, 1_000_000) : '';
  res.json({ html: renderMarkdown(content) });
});
admin.post('/media', express.raw({ type: () => true, limit: config.maxUploadBytes }), async (req, res) => {
  let fileName = req.get('X-File-Name') || '';
  try { fileName = decodeURIComponent(fileName); } catch { throw new AppError(400, 'Nama file tidak valid.'); }
  const media = await createMedia({ fileName, mimeType: req.get('Content-Type') || '', buffer: req.body });
  res.status(201).json({ ...media, url: `/media/${media.id}` });
});
admin.delete('/media/unused', async (_req, res) => res.json(await deleteUnusedMedia()));
admin.delete('/media/:id', async (req, res) => res.json(await deleteMedia(req.params.id)));
admin.put('/order', async (req, res) => res.json(await reorderCatalog(req.body)));
admin.post('/projects', async (req, res) => res.status(201).json(await createProject(req.body)));
admin.put('/projects/:id', async (req, res) => res.json(await updateProject(req.params.id, req.body)));
admin.delete('/projects/:id', async (req, res) => res.json(await deleteProject(req.params.id)));
admin.post('/sections', async (req, res) => res.status(201).json(await createSection(req.body)));
admin.put('/sections/:id', async (req, res) => res.json(await updateSection(req.params.id, req.body)));
admin.delete('/sections/:id', async (req, res) => res.json(await deleteSection(req.params.id)));
admin.post('/documents', async (req, res) => res.status(201).json(await createDocument(req.body)));
admin.put('/documents/:id', async (req, res) => res.json(await updateDocument(req.params.id, req.body)));
admin.delete('/documents/:id', async (req, res) => res.json(await deleteDocument(req.params.id)));
app.use('/api/admin', admin);

app.use(express.static(config.publicDir, { dotfiles: 'ignore', etag: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

app.use((error, req, res, _next) => {
  const status = error.status || (error instanceof SyntaxError && 'body' in error ? 400 : 500);
  if (status >= 500) console.error(error);
  const message = error.type === 'entity.too.large' ? `Ukuran file melebihi batas ${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB.` : error.message;
  const payload = { error: status >= 500 ? 'Terjadi kesalahan pada server.' : message };
  if (error.details) payload.details = error.details;
  res.status(status).json(payload);
});

app.listen(config.port, config.host, () => {
  console.log(`TerasDocs berjalan di http://${config.host}:${config.port}`);
  if (!authConfigured()) console.warn('PERINGATAN: ADMIN_PASSWORD_HASH belum dikonfigurasi; login admin dinonaktifkan.');
});
