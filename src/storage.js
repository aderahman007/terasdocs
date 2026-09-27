import { randomBytes, randomUUID } from 'node:crypto';
import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { extractTarGzip, saveStream } from './archive.js';
import { AppError, assert } from './errors.js';
import { extractMediaIds } from './markdown.js';
import { validateDocument, validateProject, validateSection } from './validation.js';
import sanitizeHtml from 'sanitize-html';

const projectsFile = path.join(config.storageDir, 'projects.json');
const documentsFile = path.join(config.storageDir, 'documents.json');
const sectionsFile = path.join(config.storageDir, 'sections.json');
const contentDir = path.join(config.storageDir, 'content');
const backupDir = path.join(config.storageDir, 'backups');
const initializedFile = path.join(config.storageDir, '.initialized');
const mediaFile = path.join(config.storageDir, 'media.json');
const uploadsDir = path.join(config.storageDir, 'uploads');
const backupManifestName = 'backup-manifest.json';
const restoreDir = path.join(config.storageDir, '.restore');
let writeQueue = Promise.resolve();
const searchIndexes = new Map();
let publicMediaIds = null;
const pendingRestores = new Map();
const RESTORE_TTL_MS = 15 * 60 * 1000;

const mediaTypes = new Map([
  ['.jpg', { mimeType: 'image/jpeg', kind: 'image' }],
  ['.jpeg', { mimeType: 'image/jpeg', kind: 'image' }],
  ['.png', { mimeType: 'image/png', kind: 'image' }],
  ['.webp', { mimeType: 'image/webp', kind: 'image' }],
  ['.gif', { mimeType: 'image/gif', kind: 'image' }],
  ['.svg', { mimeType: 'image/svg+xml', kind: 'image' }],
  ['.mp4', { mimeType: 'video/mp4', kind: 'video' }],
  ['.webm', { mimeType: 'video/webm', kind: 'video' }],
  ['.pdf', { mimeType: 'application/pdf', kind: 'pdf' }],
  ['.txt', { mimeType: 'text/plain', kind: 'file' }],
  ['.csv', { mimeType: 'text/csv', kind: 'file' }],
  ['.zip', { mimeType: 'application/zip', kind: 'file' }],
  ['.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'file' }],
  ['.xlsx', { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'file' }],
  ['.pptx', { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'file' }],
]);
const mediaMimeAliases = new Map([
  ['.jpg', ['image/pjpeg']],
  ['.jpeg', ['image/pjpeg']],
  ['.mp4', ['video/quicktime']],
  ['.csv', ['application/vnd.ms-excel']],
  ['.zip', ['application/x-zip-compressed']],
]);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function atomicWrite(file, value) {
  return atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteText(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}

async function atomicWriteBuffer(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, file);
}

function enqueue(operation) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => undefined);
  return result;
}

async function snapshot(label, files = []) {
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replaceAll(':', '-').replaceAll('.', '-');
  const id = `${timestamp}-${label}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(backupDir, id);
  await mkdir(directory, { recursive: true });

  for (const file of [projectsFile, sectionsFile, documentsFile, mediaFile, ...files]) {
    try {
      const relative = path.relative(config.storageDir, file);
      assert(!relative.startsWith('..'), 500, 'Lokasi backup tidak valid.');
      const target = path.join(directory, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await atomicWrite(path.join(directory, backupManifestName), { version: 1, id, type: 'automatic', operation: label, createdAt });
  await pruneBackups();
}

function parseLegacyBackup(id, stats) {
  const match = id.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)-(.+)-([a-f0-9]{8})$/);
  return {
    version: 1,
    id,
    type: 'automatic',
    operation: match?.[5] || 'unknown',
    createdAt: match ? `${match[1]}:${match[2]}:${match[3]}.${match[4]}` : stats.mtime.toISOString(),
  };
}

async function directorySize(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) size += await directorySize(target);
    else if (entry.isFile()) size += (await lstat(target)).size;
  }
  return size;
}

async function describeBackup(id, directory, stats, { includeSize = true } = {}) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(directory, backupManifestName), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    manifest = parseLegacyBackup(id, stats);
  }
  return { id, type: manifest.type, operation: manifest.operation, createdAt: manifest.createdAt, size: includeSize ? await directorySize(directory) : 0 };
}

async function backupEntries(options) {
  const entries = await readdir(backupDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = path.join(backupDir, entry.name);
    backups.push(await describeBackup(entry.name, directory, await lstat(directory), options));
  }
  return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function pruneBackups() {
  const backups = (await backupEntries({ includeSize: false })).filter((item) => item.type === 'automatic');
  for (const backup of backups.slice(config.backupRetention)) {
    await rm(path.join(backupDir, backup.id), { recursive: true, force: true });
  }
}

async function copyIfPresent(source, target) {
  try {
    await cp(source, target, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function assertBackupId(id) {
  assert(typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(id), 400, 'ID backup tidak valid.');
}

export async function listBackups() {
  await cleanExpiredRestores();
  return backupEntries();
}

export async function getBackup(id) {
  assertBackupId(id);
  const directory = path.join(backupDir, id);
  let stats;
  try { stats = await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(stats?.isDirectory(), 404, 'Backup tidak ditemukan.');
  return { ...await describeBackup(id, directory, stats), directory };
}

export async function createFullBackup() {
  return enqueue(createFullBackupUnlocked);
}

async function createFullBackupUnlocked() {
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replaceAll(':', '-').replaceAll('.', '-');
  const id = `${timestamp}-manual-full-${randomUUID().slice(0, 8)}`;
  const temporary = path.join(backupDir, `.tmp-${randomUUID()}`);
  const directory = path.join(backupDir, id);
  await mkdir(temporary, { recursive: true });
  try {
    for (const file of [projectsFile, sectionsFile, documentsFile, mediaFile]) {
      await atomicWrite(path.join(temporary, path.basename(file)), await readJson(file));
    }
    await copyIfPresent(initializedFile, path.join(temporary, path.basename(initializedFile)));
    await copyIfPresent(contentDir, path.join(temporary, 'content'));
    await copyIfPresent(uploadsDir, path.join(temporary, 'uploads'));
    await atomicWrite(path.join(temporary, backupManifestName), { version: 1, id, type: 'manual', operation: 'full', createdAt });
    await rename(temporary, directory);
    await pruneBackups();
    const backup = await getBackup(id);
    const { directory: _directory, ...result } = backup;
    return result;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function deleteBackup(id) {
  return enqueue(async () => {
    const backup = await getBackup(id);
    await rm(backup.directory, { recursive: true, force: true });
    return { id: backup.id };
  });
}

async function removeRestoreWorkspace(directory) {
  await rm(directory, { recursive: true, force: true });
  try {
    if (!(await readdir(restoreDir)).length) await rmdir(restoreDir);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

async function cleanExpiredRestores() {
  const now = Date.now();
  for (const [token, pending] of pendingRestores) {
    if (pending.expiresAt > now) continue;
    pendingRestores.delete(token);
    clearTimeout(pending.cleanupTimer);
    await removeRestoreWorkspace(pending.directory);
  }
}

async function discardPendingRestores() {
  for (const [token, pending] of pendingRestores) {
    pendingRestores.delete(token);
    clearTimeout(pending.cleanupTimer);
    await removeRestoreWorkspace(pending.directory);
  }
}

async function readRestoreData(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, backupManifestName), 'utf8'));
  assert(manifest?.type === 'manual' && manifest?.operation === 'full', 422, 'Hanya backup lengkap TerasDocs yang dapat dipulihkan.');
  await Promise.all(['projects.json', 'sections.json', 'documents.json', 'media.json'].map((file) => access(path.join(directory, file))));
  const projects = await readJson(path.join(directory, 'projects.json'));
  const sections = await readJson(path.join(directory, 'sections.json'));
  const documents = await readJson(path.join(directory, 'documents.json'));
  const media = await readJson(path.join(directory, 'media.json'));
  assert([projects, sections, documents, media].every(Array.isArray), 422, 'Metadata backup tidak valid.');

  const projectIds = new Set(projects.map((item) => item?.id));
  const sectionIds = new Set(sections.map((item) => item?.id));
  assert(projectIds.size === projects.length && projects.every((item) => /^[a-f0-9-]{36}$/.test(item?.id || '')), 422, 'Daftar proyek dalam backup tidak valid.');
  assert(sectionIds.size === sections.length && sections.every((item) => /^[a-f0-9-]{36}$/.test(item?.id || '') && projectIds.has(item.projectId)), 422, 'Daftar bagian dalam backup tidak valid.');
  assert(documents.every((item) => /^[a-f0-9-]{36}$/.test(item?.id || '') && projectIds.has(item.projectId) && sectionIds.has(item.sectionId)), 422, 'Daftar halaman dalam backup tidak valid.');
  assert(new Set(documents.map((item) => item.id)).size === documents.length, 422, 'Backup memuat ID halaman duplikat.');
  projects.forEach(validateProject);
  sections.forEach(validateSection);
  assert(new Set(projects.map((item) => item.slug)).size === projects.length, 422, 'Backup memuat slug proyek duplikat.');
  assert(new Set(sections.map((item) => `${item.projectId}:${item.slug}`)).size === sections.length, 422, 'Backup memuat slug bagian duplikat.');

  for (const document of documents) {
    const content = await readFile(path.join(directory, 'content', document.projectId, `${document.id}.md`), 'utf8');
    validateDocument({ ...document, content });
  }
  assert(new Set(documents.map((item) => `${item.projectId}:${item.slug}`)).size === documents.length, 422, 'Backup memuat slug halaman duplikat.');
  for (const item of media) {
    assert(/^[a-f0-9-]{36}$/.test(item?.id || '') && new RegExp(`^${item.id}\\.[a-z0-9]+$`).test(item?.storedName || ''), 422, 'Daftar media dalam backup tidak valid.');
    await access(path.join(directory, 'uploads', item.storedName));
  }
  assert(new Set(media.map((item) => item.id)).size === media.length, 422, 'Backup memuat ID media duplikat.');
  await Promise.all([mkdir(path.join(directory, 'content'), { recursive: true }), mkdir(path.join(directory, 'uploads'), { recursive: true })]);
  return { manifest, projects, sections, documents, media };
}

export async function inspectRestore(readable) {
  await cleanExpiredRestores();
  await discardPendingRestores();
  const token = randomBytes(24).toString('base64url');
  const directory = path.join(restoreDir, token);
  const archive = path.join(directory, 'upload.tar.gz');
  const extracted = path.join(directory, 'extracted');
  await mkdir(directory, { recursive: true });
  try {
    const compressedSize = await saveStream(readable, archive, config.maxBackupBytes);
    await extractTarGzip(archive, extracted, config.maxBackupBytes);
    const data = await readRestoreData(extracted);
    const expiresAt = Date.now() + RESTORE_TTL_MS;
    const preview = {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      sourceCreatedAt: data.manifest.createdAt,
      compressedSize,
      projects: data.projects.length,
      sections: data.sections.length,
      documents: data.documents.length,
      media: data.media.length,
    };
    const cleanupTimer = setTimeout(() => {
      const pending = pendingRestores.get(token);
      if (!pending) return;
      pendingRestores.delete(token);
      void removeRestoreWorkspace(pending.directory);
    }, RESTORE_TTL_MS);
    cleanupTimer.unref?.();
    pendingRestores.set(token, { directory, extracted, expiresAt, preview, cleanupTimer });
    return preview;
  } catch (error) {
    pendingRestores.delete(token);
    await removeRestoreWorkspace(directory);
    if (error.status === 413 || error instanceof AppError) throw error;
    throw new AppError(422, 'Arsip backup tidak lengkap, tidak aman, atau rusak.');
  }
}

export async function discardRestore(token) {
  assert(typeof token === 'string' && /^[a-zA-Z0-9_-]{32}$/.test(token), 400, 'Token restore tidak valid.');
  const pending = pendingRestores.get(token);
  pendingRestores.delete(token);
  if (pending) {
    clearTimeout(pending.cleanupTimer);
    await removeRestoreWorkspace(pending.directory);
  }
  return { discarded: Boolean(pending) };
}

async function restoreFile(file, previous) {
  if (previous === null) await rm(file, { force: true });
  else await atomicWriteText(file, previous);
}

export async function restoreBackup(token) {
  return enqueue(async () => {
    await cleanExpiredRestores();
    assert(typeof token === 'string' && /^[a-zA-Z0-9_-]{32}$/.test(token), 400, 'Token restore tidak valid.');
    const pending = pendingRestores.get(token);
    assert(pending && pending.expiresAt > Date.now(), 410, 'Preview restore telah kedaluwarsa. Unggah ulang backup.');
    const data = await readRestoreData(pending.extracted);
    const safetyBackup = await createFullBackupUnlocked();
    const rollback = path.join(pending.directory, 'rollback');
    const incomingContent = path.join(pending.extracted, 'content');
    const incomingUploads = path.join(pending.extracted, 'uploads');
    const previousFiles = new Map();
    for (const file of [projectsFile, sectionsFile, documentsFile, mediaFile]) {
      try { previousFiles.set(file, await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') previousFiles.set(file, null); else throw error; }
    }
    await mkdir(rollback, { recursive: true });
    let contentMoved = false;
    let uploadsMoved = false;
    try {
      await rename(contentDir, path.join(rollback, 'content'));
      contentMoved = true;
      await rename(incomingContent, contentDir);
      await rename(uploadsDir, path.join(rollback, 'uploads'));
      uploadsMoved = true;
      await rename(incomingUploads, uploadsDir);
      await Promise.all([
        atomicWrite(projectsFile, data.projects),
        atomicWrite(sectionsFile, data.sections),
        atomicWrite(documentsFile, data.documents),
        atomicWrite(mediaFile, data.media),
      ]);
      await writeFile(initializedFile, `${new Date().toISOString()}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      await Promise.all([...previousFiles].map(([file, previous]) => restoreFile(file, previous)));
      if (contentMoved) {
        await rm(contentDir, { recursive: true, force: true });
        await rename(path.join(rollback, 'content'), contentDir);
      }
      if (uploadsMoved) {
        await rm(uploadsDir, { recursive: true, force: true });
        await rename(path.join(rollback, 'uploads'), uploadsDir);
      }
      pendingRestores.delete(token);
      clearTimeout(pending.cleanupTimer);
      await removeRestoreWorkspace(pending.directory);
      throw error;
    }
    pendingRestores.delete(token);
    clearTimeout(pending.cleanupTimer);
    await removeRestoreWorkspace(pending.directory);
    invalidateSearchIndex();
    return { restored: true, safetyBackupId: safetyBackup.id, ...pending.preview };
  });
}

function projectContentPath(projectId) {
  assert(/^[a-f0-9-]{36}$/.test(projectId), 400, 'ID proyek tidak valid.');
  return path.join(contentDir, projectId);
}

function contentPath(projectId, documentId) {
  assert(/^[a-f0-9-]{36}$/.test(documentId), 400, 'ID dokumen tidak valid.');
  return path.join(projectContentPath(projectId), `${documentId}.md`);
}

function sanitizeSvg(buffer) {
  const source = buffer.toString('utf8');
  assert(!/<!(?:DOCTYPE|ENTITY)/i.test(source), 422, 'SVG tidak boleh memuat DOCTYPE atau ENTITY.');
  const allowedTags = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'title', 'desc'];
  const allowedAttributes = {
    svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'role', 'aria-label'],
    '*': ['id', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'viewBox', 'width', 'height', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'offset', 'stop-color', 'stop-opacity', 'clip-path', 'mask', 'font-size', 'text-anchor'],
  };
  const sanitized = sanitizeHtml(source, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: [],
    allowProtocolRelative: false,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    exclusiveFilter(frame) {
      return ['fill', 'stroke', 'clip-path', 'mask'].some((attribute) => /(?:javascript:|data:|https?:|url\((?!#))/i.test(frame.attribs[attribute] || ''));
    },
  });
  assert(/<svg(?:\s|>)/.test(sanitized), 422, 'Isi SVG tidak valid.');
  return Buffer.from(sanitized);
}

function verifyMediaSignature(buffer, extension) {
  const startsWith = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  if (extension === '.jpg' || extension === '.jpeg') return startsWith(0xff, 0xd8, 0xff);
  if (extension === '.png') return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (extension === '.webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (extension === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.mp4') return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  if (extension === '.webm') return startsWith(0x1a, 0x45, 0xdf, 0xa3);
  if (['.zip', '.docx', '.xlsx', '.pptx'].includes(extension)) return startsWith(0x50, 0x4b);
  if (extension === '.txt' || extension === '.csv') return !buffer.includes(0);
  return extension === '.svg';
}

function sortItems(items) {
  return [...items].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'id'));
}

function projectVisibility(project) {
  if (['public', 'private', 'draft'].includes(project?.visibility)) return project.visibility;
  return project?.published === false ? 'draft' : 'public';
}

function normalizeProject(project) {
  const visibility = projectVisibility(project);
  return { ...project, visibility, published: visibility !== 'draft' };
}

function nextOrder(items) {
  if (!items.length) return 0;
  const order = Math.max(...items.map((item) => Number(item.order) || 0)) + 1;
  assert(order <= 9999, 422, 'Batas jumlah item untuk pengurutan telah tercapai.');
  return order;
}

function assertExactIds(actualItems, proposedIds, label) {
  assert(Array.isArray(proposedIds), 422, `${label} harus berupa daftar.`);
  assert(proposedIds.every((id) => typeof id === 'string'), 422, `${label} berisi ID tidak valid.`);
  const proposed = new Set(proposedIds);
  assert(proposed.size === proposedIds.length, 422, `${label} tidak boleh memuat ID yang sama lebih dari sekali.`);
  assert(proposed.size === actualItems.length && actualItems.every((item) => proposed.has(item.id)), 409, `${label} sudah berubah. Muat ulang panel admin lalu coba lagi.`);
}

function invalidateSearchIndex() {
  searchIndexes.clear();
  publicMediaIds = null;
}

export async function initializeStorage() {
  await rm(restoreDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(contentDir, { recursive: true }),
    mkdir(backupDir, { recursive: true }),
    mkdir(uploadsDir, { recursive: true }),
  ]);
  const now = new Date().toISOString();
  let initialized = false;
  try {
    await readFile(initializedFile);
    initialized = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let projects = await readJson(projectsFile);
  let documents = await readJson(documentsFile);
  let sections = await readJson(sectionsFile);

  if (!Array.isArray(projects) || !Array.isArray(sections) || !Array.isArray(documents)) throw new AppError(500, 'File penyimpanan harus berupa array JSON.');

  if (!initialized && !projects.length && !documents.length) {
    const projectId = randomUUID();
    const sectionId = randomUUID();
    const documentId = randomUUID();
    projects = [{
      id: projectId,
      title: 'Panduan Produk',
      slug: 'panduan-produk',
      description: 'Dokumentasi pertama Anda. Kelola konten ini melalui panel admin.',
      order: 0,
      visibility: 'public',
      published: true,
      createdAt: now,
      updatedAt: now,
    }];
    sections = [{
      id: sectionId,
      projectId,
      title: 'Memulai',
      slug: 'memulai',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }];
    documents = [{
      id: documentId,
      projectId,
      sectionId,
      title: 'Selamat Datang',
      slug: 'selamat-datang',
      excerpt: 'Pelajari cara mengelola website dokumentasi ini.',
      order: 0,
      published: true,
      createdAt: now,
      updatedAt: now,
    }];
    await mkdir(path.dirname(contentPath(projectId, documentId)), { recursive: true });
    await atomicWriteText(contentPath(projectId, documentId), `# Selamat Datang\n\nWebsite dokumentasi Anda sudah siap digunakan.\n\n## Mulai mengelola konten\n\n1. Buka halaman **Admin**.\n2. Login menggunakan akun yang dikonfigurasi di server.\n3. Buat proyek atau halaman dokumentasi baru.\n\n> Semua konten disimpan sebagai Markdown dan metadata disimpan dalam JSON.\n`);
    await Promise.all([atomicWrite(projectsFile, projects), atomicWrite(sectionsFile, sections), atomicWrite(documentsFile, documents)]);
  } else {
    let migrated = false;
    let migratedProjects = false;
    for (const project of projects) {
      if (!['public', 'private', 'draft'].includes(project.visibility)) {
        project.visibility = project.published === false ? 'draft' : 'public';
        project.published = project.visibility !== 'draft';
        migrated = true;
        migratedProjects = true;
      }
      let projectSections = sections.filter((section) => section.projectId === project.id);
      if (!projectSections.length) {
        const section = { id: randomUUID(), projectId: project.id, title: 'Umum', slug: 'umum', order: 0, createdAt: now, updatedAt: now };
        sections.push(section);
        projectSections = [section];
        migrated = true;
      }
      const sectionIds = new Set(projectSections.map((section) => section.id));
      documents = documents.map((document) => {
        if (document.projectId !== project.id || sectionIds.has(document.sectionId)) return document;
        migrated = true;
        return { ...document, sectionId: projectSections[0].id, updatedAt: now };
      });
    }
    if (migrated) {
      await snapshot(migratedProjects ? 'migrate-project-visibility' : 'migrate-sections');
      await Promise.all([atomicWrite(projectsFile, projects), atomicWrite(sectionsFile, sections), atomicWrite(documentsFile, documents)]);
    }
  }
  if (!initialized) await writeFile(initializedFile, `${now}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function getCatalog({ admin = false, includePrivate = false } = {}) {
  const [projects, sections, documents] = await Promise.all([readJson(projectsFile), readJson(sectionsFile), readJson(documentsFile)]);
  const normalizedProjects = projects.map(normalizeProject);
  const visibleProjects = admin
    ? normalizedProjects
    : normalizedProjects.filter((item) => item.visibility === 'public' || (includePrivate && item.visibility === 'private'));
  const visibleIds = new Set(visibleProjects.map((item) => item.id));
  const visibleSections = sections.filter((item) => visibleIds.has(item.projectId));
  const visibleDocuments = documents.filter((item) => visibleIds.has(item.projectId) && (admin || item.published));
  return { projects: sortItems(visibleProjects), sections: sortItems(visibleSections), documents: sortItems(visibleDocuments) };
}

export async function getProjects(options = {}) {
  const { projects, documents } = await getCatalog(options);
  return projects.map((project) => ({ ...project, documentCount: documents.filter((item) => item.projectId === project.id).length }));
}

export async function getNavigation(projectSlug, { includePrivate = false } = {}) {
  const adminCatalog = await getCatalog({ admin: true });
  const requestedProject = adminCatalog.projects.find((item) => item.slug === projectSlug);
  assert(requestedProject && requestedProject.visibility !== 'draft', 404, 'Proyek dokumentasi tidak ditemukan.');
  assert(requestedProject.visibility !== 'private' || includePrivate, 401, 'Dokumentasi ini bersifat privat. Silakan login untuk melanjutkan.');
  const { projects, sections, documents } = await getCatalog({ includePrivate });
  const project = projects.find((item) => item.id === requestedProject.id);
  const projectSections = sections.filter((item) => item.projectId === project.id);
  const sectionOrder = new Map(projectSections.map((item, index) => [item.id, index]));
  const projectDocuments = documents.filter((item) => item.projectId === project.id).sort((a, b) => {
    const bySection = (sectionOrder.get(a.sectionId) ?? 9999) - (sectionOrder.get(b.sectionId) ?? 9999);
    return bySection || a.order - b.order || a.title.localeCompare(b.title, 'id');
  });
  return { project, sections: projectSections, documents: projectDocuments };
}

export async function searchDocuments(query, { includePrivate = false } = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase('id').slice(0, 100);
  if (needle.length < 2) return [];
  const indexKey = includePrivate ? 'private' : 'public';
  if (!searchIndexes.has(indexKey)) {
    const { projects, documents } = await getCatalog({ includePrivate });
    const projectMap = new Map(projects.map((item) => [item.id, item]));
    const searchIndex = [];
    for (const document of documents) {
      let content = '';
      try { content = await readFile(contentPath(document.projectId, document.id), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      searchIndex.push({ document, project: projectMap.get(document.projectId), searchable: `${document.title} ${document.excerpt} ${content}`.toLocaleLowerCase('id') });
    }
    searchIndexes.set(indexKey, searchIndex);
  }
  return searchIndexes.get(indexKey).filter((item) => item.searchable.includes(needle)).slice(0, 20).map(({ document, project }) => ({ ...document, project }));
}

export async function getDocument(id, { admin = false, includePrivate = false } = {}) {
  if (!admin) {
    const adminCatalog = await getCatalog({ admin: true });
    const requestedDocument = adminCatalog.documents.find((item) => item.id === id);
    const requestedProject = requestedDocument && adminCatalog.projects.find((item) => item.id === requestedDocument.projectId);
    assert(requestedDocument?.published && requestedProject?.visibility !== 'draft', 404, 'Dokumen tidak ditemukan.');
    assert(requestedProject.visibility !== 'private' || includePrivate, 401, 'Dokumentasi ini bersifat privat. Silakan login untuk melanjutkan.');
  }
  const { projects, documents } = await getCatalog({ admin, includePrivate });
  const document = documents.find((item) => item.id === id);
  assert(document, 404, 'Dokumen tidak ditemukan.');
  const project = projects.find((item) => item.id === document.projectId);
  assert(project, 404, 'Proyek dokumentasi tidak ditemukan.');
  const content = await readFile(contentPath(project.id, document.id), 'utf8');
  return { ...document, content, project };
}

export async function createProject(input) {
  return enqueue(async () => {
    const project = validateProject(input);
    const projects = await readJson(projectsFile);
    assert(!projects.some((item) => item.slug === project.slug), 409, 'Slug proyek sudah digunakan.');
    const now = new Date().toISOString();
    const created = { id: randomUUID(), ...project, order: nextOrder(projects), createdAt: now, updatedAt: now };
    const section = { id: randomUUID(), projectId: created.id, title: 'Umum', slug: 'umum', order: 0, createdAt: now, updatedAt: now };
    await snapshot('create-project');
    const sections = await readJson(sectionsFile);
    await Promise.all([atomicWrite(projectsFile, [...projects, created]), atomicWrite(sectionsFile, [...sections, section])]);
    invalidateSearchIndex();
    return created;
  });
}

export async function updateProject(id, input) {
  return enqueue(async () => {
    const changes = validateProject(input);
    const projects = await readJson(projectsFile);
    const index = projects.findIndex((item) => item.id === id);
    assert(index >= 0, 404, 'Proyek tidak ditemukan.');
    assert(!projects.some((item) => item.id !== id && item.slug === changes.slug), 409, 'Slug proyek sudah digunakan.');
    projects[index] = { ...projects[index], ...changes, updatedAt: new Date().toISOString() };
    await snapshot('update-project');
    await atomicWrite(projectsFile, projects);
    invalidateSearchIndex();
    return projects[index];
  });
}

export async function deleteProject(id) {
  return enqueue(async () => {
    const [projects, sections, documents] = await Promise.all([readJson(projectsFile), readJson(sectionsFile), readJson(documentsFile)]);
    const project = projects.find((item) => item.id === id);
    assert(project, 404, 'Proyek tidak ditemukan.');
    const removedSections = sections.filter((item) => item.projectId === id);
    const removedDocuments = documents.filter((item) => item.projectId === id);
    const files = removedDocuments.map((item) => contentPath(id, item.id));
    await snapshot('delete-project', files);
    await Promise.all([
      atomicWrite(projectsFile, projects.filter((item) => item.id !== id)),
      atomicWrite(sectionsFile, sections.filter((item) => item.projectId !== id)),
      atomicWrite(documentsFile, documents.filter((item) => item.projectId !== id)),
    ]);
    await rm(projectContentPath(id), { recursive: true, force: true });
    invalidateSearchIndex();
    return { project, removedSections: removedSections.length, removedDocuments: removedDocuments.length };
  });
}

export async function createSection(input) {
  return enqueue(async () => {
    const section = validateSection(input);
    const [projects, sections] = await Promise.all([readJson(projectsFile), readJson(sectionsFile)]);
    assert(projects.some((item) => item.id === section.projectId), 422, 'Proyek tidak ditemukan.');
    assert(!sections.some((item) => item.projectId === section.projectId && item.slug === section.slug), 409, 'Slug bagian sudah digunakan dalam proyek ini.');
    const now = new Date().toISOString();
    const projectSections = sections.filter((item) => item.projectId === section.projectId);
    const created = { id: randomUUID(), ...section, order: nextOrder(projectSections), createdAt: now, updatedAt: now };
    await snapshot('create-section');
    await atomicWrite(sectionsFile, [...sections, created]);
    return created;
  });
}

export async function updateSection(id, input) {
  return enqueue(async () => {
    const changes = validateSection(input);
    const [projects, sections] = await Promise.all([readJson(projectsFile), readJson(sectionsFile)]);
    const index = sections.findIndex((item) => item.id === id);
    assert(index >= 0, 404, 'Bagian tidak ditemukan.');
    assert(projects.some((item) => item.id === changes.projectId), 422, 'Proyek tidak ditemukan.');
    assert(!sections.some((item) => item.id !== id && item.projectId === changes.projectId && item.slug === changes.slug), 409, 'Slug bagian sudah digunakan dalam proyek ini.');
    if (sections[index].projectId !== changes.projectId) changes.order = nextOrder(sections.filter((item) => item.id !== id && item.projectId === changes.projectId));
    sections[index] = { ...sections[index], ...changes, updatedAt: new Date().toISOString() };
    await snapshot('update-section');
    await atomicWrite(sectionsFile, sections);
    return sections[index];
  });
}

export async function deleteSection(id) {
  return enqueue(async () => {
    const [sections, documents] = await Promise.all([readJson(sectionsFile), readJson(documentsFile)]);
    const section = sections.find((item) => item.id === id);
    assert(section, 404, 'Bagian tidak ditemukan.');
    assert(!documents.some((item) => item.sectionId === id), 409, 'Pindahkan atau hapus seluruh halaman dalam bagian ini terlebih dahulu.');
    assert(sections.filter((item) => item.projectId === section.projectId).length > 1, 409, 'Sebuah proyek harus memiliki minimal satu bagian.');
    await snapshot('delete-section');
    await atomicWrite(sectionsFile, sections.filter((item) => item.id !== id));
    return section;
  });
}

export async function createDocument(input) {
  return enqueue(async () => {
    const data = validateDocument(input);
    const [projects, sections, documents] = await Promise.all([readJson(projectsFile), readJson(sectionsFile), readJson(documentsFile)]);
    assert(projects.some((item) => item.id === data.projectId), 422, 'Proyek tidak ditemukan.');
    assert(sections.some((item) => item.id === data.sectionId && item.projectId === data.projectId), 422, 'Bagian tidak ditemukan dalam proyek yang dipilih.');
    assert(!documents.some((item) => item.projectId === data.projectId && item.slug === data.slug), 409, 'Slug dokumen sudah digunakan dalam proyek ini.');
    const now = new Date().toISOString();
    const { content, ...metadata } = data;
    const siblingDocuments = documents.filter((item) => item.projectId === data.projectId && item.sectionId === data.sectionId);
    const created = { id: randomUUID(), ...metadata, order: nextOrder(siblingDocuments), createdAt: now, updatedAt: now };
    const file = contentPath(created.projectId, created.id);
    await snapshot('create-document');
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, `${content.trim()}\n`);
    await atomicWrite(documentsFile, [...documents, created]);
    invalidateSearchIndex();
    return { ...created, content };
  });
}

export async function updateDocument(id, input) {
  return enqueue(async () => {
    const data = validateDocument(input);
    const [projects, sections, documents] = await Promise.all([readJson(projectsFile), readJson(sectionsFile), readJson(documentsFile)]);
    const index = documents.findIndex((item) => item.id === id);
    assert(index >= 0, 404, 'Dokumen tidak ditemukan.');
    assert(projects.some((item) => item.id === data.projectId), 422, 'Proyek tidak ditemukan.');
    assert(sections.some((item) => item.id === data.sectionId && item.projectId === data.projectId), 422, 'Bagian tidak ditemukan dalam proyek yang dipilih.');
    assert(!documents.some((item) => item.id !== id && item.projectId === data.projectId && item.slug === data.slug), 409, 'Slug dokumen sudah digunakan dalam proyek ini.');

    const previous = documents[index];
    const previousFile = contentPath(previous.projectId, previous.id);
    const nextFile = contentPath(data.projectId, id);
    const { content, ...metadata } = data;
    if (previous.projectId !== data.projectId || previous.sectionId !== data.sectionId) {
      metadata.order = nextOrder(documents.filter((item) => item.id !== id && item.projectId === data.projectId && item.sectionId === data.sectionId));
    }
    documents[index] = { ...previous, ...metadata, updatedAt: new Date().toISOString() };
    await snapshot('update-document', [previousFile]);
    await mkdir(path.dirname(nextFile), { recursive: true });
    await atomicWriteText(nextFile, `${content.trim()}\n`);
    if (previousFile !== nextFile) await rm(previousFile, { force: true });
    await atomicWrite(documentsFile, documents);
    invalidateSearchIndex();
    return { ...documents[index], content };
  });
}

export async function deleteDocument(id) {
  return enqueue(async () => {
    const documents = await readJson(documentsFile);
    const document = documents.find((item) => item.id === id);
    assert(document, 404, 'Dokumen tidak ditemukan.');
    const file = contentPath(document.projectId, document.id);
    await snapshot('delete-document', [file]);
    await atomicWrite(documentsFile, documents.filter((item) => item.id !== id));
    await rm(file, { force: true });
    invalidateSearchIndex();
    return document;
  });
}

export async function reorderCatalog(input) {
  return enqueue(async () => {
    const [projects, sections, documents] = await Promise.all([readJson(projectsFile), readJson(sectionsFile), readJson(documentsFile)]);
    assertExactIds(projects, input?.projectIds, 'Daftar proyek');
    assert(Array.isArray(input?.structures), 422, 'Struktur dokumentasi harus berupa daftar.');
    const structureMap = new Map(input.structures.map((structure) => [structure?.projectId, structure]));
    assert(structureMap.size === projects.length, 409, 'Struktur proyek sudah berubah. Muat ulang panel admin lalu coba lagi.');

    const projectOrder = new Map(input.projectIds.map((id, index) => [id, index]));
    const sectionOrder = new Map();
    const documentPlacement = new Map();

    for (const project of projects) {
      const structure = structureMap.get(project.id);
      assert(structure && Array.isArray(structure.sections), 422, `Struktur proyek “${project.title}” tidak valid.`);
      const projectSections = sections.filter((item) => item.projectId === project.id);
      assertExactIds(projectSections, structure.sections.map((item) => item?.id), `Daftar bagian pada proyek “${project.title}”`);
      const projectDocuments = documents.filter((item) => item.projectId === project.id);
      const proposedDocumentIds = structure.sections.flatMap((item) => Array.isArray(item?.documentIds) ? item.documentIds : []);
      assertExactIds(projectDocuments, proposedDocumentIds, `Daftar halaman pada proyek “${project.title}”`);

      structure.sections.forEach((section, sectionIndex) => {
        assert(Array.isArray(section.documentIds), 422, 'Daftar halaman dalam bagian harus berupa daftar.');
        sectionOrder.set(section.id, sectionIndex);
        section.documentIds.forEach((documentId, documentIndex) => {
          documentPlacement.set(documentId, { sectionId: section.id, order: documentIndex });
        });
      });
    }

    const now = new Date().toISOString();
    const reorderedProjects = projects.map((item) => ({ ...item, order: projectOrder.get(item.id), updatedAt: now }));
    const reorderedSections = sections.map((item) => ({ ...item, order: sectionOrder.get(item.id), updatedAt: now }));
    const reorderedDocuments = documents.map((item) => {
      const placement = documentPlacement.get(item.id);
      return { ...item, sectionId: placement.sectionId, order: placement.order, updatedAt: now };
    });

    await snapshot('reorder-catalog');
    await Promise.all([
      atomicWrite(projectsFile, reorderedProjects),
      atomicWrite(sectionsFile, reorderedSections),
      atomicWrite(documentsFile, reorderedDocuments),
    ]);
    invalidateSearchIndex();
    return { reordered: true };
  });
}

export async function listMedia() {
  const items = await readJson(mediaFile);
  assert(Array.isArray(items), 500, 'File metadata media harus berupa array JSON.');
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMediaInventory() {
  const [items, documents, projects, uploadEntries] = await Promise.all([
    listMedia(),
    readJson(documentsFile),
    readJson(projectsFile),
    readdir(uploadsDir, { withFileTypes: true }),
  ]);
  assert(Array.isArray(documents) && Array.isArray(projects), 500, 'Metadata dokumentasi tidak valid.');

  const references = new Map(items.map((item) => [item.id, []]));
  const projectDetails = new Map(projects.map((item) => [item.id, normalizeProject(item)]));
  for (const document of documents) {
    let content;
    try {
      content = await readFile(contentPath(document.projectId, document.id), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const referencedIds = extractMediaIds(content);
    for (const id of referencedIds) {
      if (!references.has(id)) continue;
      references.get(id).push({
        documentId: document.id,
        documentTitle: document.title,
        projectId: document.projectId,
        projectTitle: projectDetails.get(document.projectId)?.title || 'Proyek tidak ditemukan',
        projectVisibility: projectDetails.get(document.projectId)?.visibility || 'draft',
        published: Boolean(document.published),
      });
    }
  }

  const uploadNames = new Set(uploadEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const knownNames = new Set(items.map((item) => item.storedName));
  const enriched = items.map((item) => {
    const itemReferences = references.get(item.id) || [];
    const fileExists = uploadNames.has(item.storedName);
    const status = fileExists
      ? (itemReferences.length ? 'used' : 'unused')
      : (itemReferences.length ? 'missing-used' : 'missing');
    return { ...item, fileExists, status, usageCount: itemReferences.length, references: itemReferences };
  });
  const orphanFiles = [...uploadNames].filter((name) => name !== '.gitkeep' && !knownNames.has(name)).sort();

  return {
    items: enriched,
    summary: {
      total: enriched.length,
      used: enriched.filter((item) => item.usageCount > 0).length,
      unused: enriched.filter((item) => item.usageCount === 0).length,
      missing: enriched.filter((item) => !item.fileExists).length,
      orphanFiles: orphanFiles.length,
      totalBytes: enriched.reduce((total, item) => total + (item.fileExists ? item.size : 0), 0),
      unusedBytes: enriched.reduce((total, item) => total + (item.fileExists && item.usageCount === 0 ? item.size : 0), 0),
    },
    orphanFiles,
  };
}

export async function getMedia(id) {
  assert(/^[a-f0-9-]{36}$/.test(id), 400, 'ID media tidak valid.');
  const items = await listMedia();
  const media = items.find((item) => item.id === id);
  assert(media, 404, 'Media tidak ditemukan.');
  assert(new RegExp(`^${id}\\.[a-z0-9]+$`).test(media.storedName), 500, 'Metadata lokasi media tidak valid.');
  return { ...media, filePath: path.join(uploadsDir, media.storedName) };
}

async function getPublicMediaIds() {
  if (publicMediaIds) return publicMediaIds;
  const { documents } = await getCatalog();
  const ids = new Set();
  for (const document of documents) {
    let content = '';
    try {
      content = await readFile(contentPath(document.projectId, document.id), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const id of extractMediaIds(content)) ids.add(id);
  }
  publicMediaIds = ids;
  return ids;
}

export async function getMediaForViewer(id, { authenticated = false } = {}) {
  const media = await getMedia(id);
  if (authenticated) return media;
  assert((await getPublicMediaIds()).has(id), 401, 'File ini merupakan bagian dari dokumentasi privat. Silakan login untuk mengaksesnya.');
  return media;
}

export async function createMedia({ fileName, mimeType, buffer }) {
  return enqueue(async () => {
    assert(Buffer.isBuffer(buffer) && buffer.length > 0, 422, 'File upload kosong.');
    assert(buffer.length <= config.maxUploadBytes, 413, `Ukuran file melebihi batas ${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB.`);
    const originalName = path.basename(String(fileName || '')).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
    const extension = path.extname(originalName).toLowerCase();
    const type = mediaTypes.get(extension);
    assert(originalName && type, 422, 'Jenis file tidak didukung.');
    const acceptedMimeTypes = [type.mimeType, ...(mediaMimeAliases.get(extension) || [])];
    assert(!mimeType || mimeType === 'application/octet-stream' || acceptedMimeTypes.includes(mimeType), 422, 'Tipe file tidak sesuai dengan ekstensi.');
    let contents = buffer;
    if (extension === '.svg') contents = sanitizeSvg(buffer);
    assert(verifyMediaSignature(contents, extension), 422, 'Isi file tidak sesuai dengan jenis file.');

    const items = await readJson(mediaFile);
    assert(Array.isArray(items), 500, 'File metadata media harus berupa array JSON.');
    const id = randomUUID();
    const storedName = `${id}${extension}`;
    const now = new Date().toISOString();
    const media = { id, originalName, storedName, mimeType: type.mimeType, kind: type.kind, size: contents.length, createdAt: now };
    await snapshot('upload-media');
    const file = path.join(uploadsDir, storedName);
    await atomicWriteBuffer(file, contents);
    try {
      await atomicWrite(mediaFile, [...items, media]);
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    }
    return media;
  });
}

export async function deleteMedia(id) {
  return enqueue(async () => {
    assert(/^[a-f0-9-]{36}$/.test(id), 400, 'ID media tidak valid.');
    const [items, inventory] = await Promise.all([readJson(mediaFile), getMediaInventory()]);
    const media = items.find((item) => item.id === id);
    assert(media, 404, 'Media tidak ditemukan.');
    const references = inventory.items.find((item) => item.id === id)?.references || [];
    const titles = references.map((item) => item.documentTitle);
    assert(!references.length, 409, `Media masih digunakan oleh halaman: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ', dan lainnya' : ''}.`);
    const file = path.join(uploadsDir, media.storedName);
    await snapshot('delete-media', [file]);
    await atomicWrite(mediaFile, items.filter((item) => item.id !== id));
    await rm(file, { force: true });
    return media;
  });
}

export async function deleteUnusedMedia() {
  return enqueue(async () => {
    const [items, inventory] = await Promise.all([readJson(mediaFile), getMediaInventory()]);
    const unused = inventory.items.filter((item) => item.usageCount === 0);
    if (!unused.length) return { deleted: 0, freedBytes: 0 };
    const unusedIds = new Set(unused.map((item) => item.id));
    const files = unused.filter((item) => item.fileExists).map((item) => path.join(uploadsDir, item.storedName));
    await snapshot('delete-unused-media', files);
    await atomicWrite(mediaFile, items.filter((item) => !unusedIds.has(item.id)));
    await Promise.all(files.map((file) => rm(file, { force: true })));
    return { deleted: unused.length, freedBytes: unused.reduce((total, item) => total + (item.fileExists ? item.size : 0), 0) };
  });
}
