import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const directory = await mkdtemp(path.join(os.tmpdir(), 'terasdocs-test-'));
process.env.STORAGE_DIR = directory;
const storage = await import('../src/storage.js');
const { streamTarGzip } = await import('../src/archive.js');

test.after(async () => rm(directory, { recursive: true, force: true }));

test('storage menginisialisasi contoh hanya sekali', async () => {
  await storage.initializeStorage();
  const first = await storage.getCatalog({ admin: true });
  assert.equal(first.projects.length, 1);
  assert.equal(first.sections.length, 1);
  assert.equal(first.documents.length, 1);

  await storage.deleteProject(first.projects[0].id);
  await storage.initializeStorage();
  const second = await storage.getCatalog({ admin: true });
  assert.equal(second.projects.length, 0);
  assert.equal(second.documents.length, 0);
});

test('storage menjalankan CRUD proyek dan dokumen serta membuat backup', async () => {
  const project = await storage.createProject({ title: 'API', slug: 'api', description: 'Referensi API', order: 0, published: true });
  const catalog = await storage.getCatalog({ admin: true });
  const section = catalog.sections.find((item) => item.projectId === project.id);
  const document = await storage.createDocument({ projectId: project.id, sectionId: section.id, title: 'Autentikasi', slug: 'autentikasi', excerpt: '', content: '# Token', order: 0, published: true });
  const detail = await storage.getDocument(document.id, { admin: true });
  assert.equal(detail.content.trim(), '# Token');
  const projects = await storage.getProjects();
  assert.equal(projects.find((item) => item.id === project.id).documentCount, 1);
  const navigation = await storage.getNavigation('api');
  assert.equal(navigation.sections.length, 1);
  assert.equal(navigation.documents[0].sectionId, section.id);
  assert.equal((await storage.searchDocuments('Token'))[0].id, document.id);

  await storage.updateDocument(document.id, { ...document, content: '# Token baru', title: 'Token API' });
  const updated = await storage.getDocument(document.id, { admin: true });
  assert.equal(updated.title, 'Token API');
  assert.equal(updated.content.trim(), '# Token baru');

  await storage.deleteDocument(document.id);
  await assert.rejects(() => storage.getDocument(document.id, { admin: true }), /tidak ditemukan/);
  assert.ok((await readdir(path.join(directory, 'backups'))).length > 0);
});

test('proyek privat hanya tersedia untuk pembaca yang sudah login', async () => {
  const project = await storage.createProject({ title: 'Panduan Internal', slug: 'panduan-internal', description: 'Khusus admin', order: 0, visibility: 'private' });
  const draftProject = await storage.createProject({ title: 'Belum Siap', slug: 'belum-siap', description: '', order: 0, visibility: 'draft' });
  const adminCatalog = await storage.getCatalog({ admin: true });
  const section = adminCatalog.sections.find((item) => item.projectId === project.id);
  const mediaSource = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  const media = await storage.createMedia({ fileName: 'internal.svg', mimeType: 'image/svg+xml', buffer: mediaSource });
  const document = await storage.createDocument({ projectId: project.id, sectionId: section.id, title: 'Rahasia Internal', slug: 'rahasia-internal', excerpt: '', content: `# Rahasia Internal\n\n![Internal](/media/${media.id})`, order: 0, published: true });

  assert.equal((await storage.getProjects()).some((item) => item.id === project.id), false);
  assert.equal((await storage.getProjects({ includePrivate: true })).some((item) => item.id === project.id), true);
  assert.equal((await storage.getProjects({ includePrivate: true })).some((item) => item.id === draftProject.id), false);
  await assert.rejects(() => storage.getNavigation(project.slug), /privat/);
  assert.equal((await storage.getNavigation(project.slug, { includePrivate: true })).project.id, project.id);
  await assert.rejects(() => storage.getDocument(document.id), /privat/);
  assert.equal((await storage.getDocument(document.id, { includePrivate: true })).id, document.id);
  assert.equal((await storage.searchDocuments('Rahasia Internal')).length, 0);
  assert.equal((await storage.searchDocuments('Rahasia Internal', { includePrivate: true }))[0].id, document.id);
  await assert.rejects(() => storage.getMediaForViewer(media.id), /privat/);
  assert.equal((await storage.getMediaForViewer(media.id, { authenticated: true })).id, media.id);

  await storage.deleteProject(project.id);
  await storage.deleteProject(draftProject.id);
  await storage.deleteMedia(media.id);
});

test('admin dapat membuat, mengarsipkan, dan menghapus backup lengkap', async () => {
  await writeFile(path.join(directory, 'content', '.gitkeep'), '');
  await writeFile(path.join(directory, 'uploads', '.gitkeep'), '');
  const backup = await storage.createFullBackup();
  assert.equal(backup.type, 'manual');
  assert.equal(backup.operation, 'full');
  assert.ok(backup.size > 0);

  const listed = await storage.listBackups();
  assert.ok(listed.some((item) => item.id === backup.id));
  const stored = await storage.getBackup(backup.id);
  assert.equal(JSON.parse(await readFile(path.join(stored.directory, 'backup-manifest.json'), 'utf8')).id, backup.id);
  assert.ok((await readFile(path.join(stored.directory, 'projects.json'), 'utf8')).startsWith('['));

  const archiveFile = path.join(directory, `${backup.id}.tar.gz`);
  await streamTarGzip(stored.directory, createWriteStream(archiveFile));
  const archive = await readFile(archiveFile);
  assert.deepEqual([...archive.subarray(0, 2)], [0x1f, 0x8b]);
  const tar = gunzipSync(archive);
  const archivedFiles = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    archivedFiles.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(archivedFiles.includes('terasdocs-backup/projects.json'));
  assert.ok(archivedFiles.includes('terasdocs-backup/backup-manifest.json'));

  const projectAfterBackup = await storage.createProject({ title: 'Tidak Ikut Restore', slug: 'tidak-ikut-restore', description: '', order: 0, published: true });
  const preview = await storage.inspectRestore(createReadStream(archiveFile));
  assert.equal(preview.projects, JSON.parse(await readFile(path.join(stored.directory, 'projects.json'), 'utf8')).length);
  const restored = await storage.restoreBackup(preview.token);
  assert.equal(restored.restored, true);
  assert.ok((await storage.listBackups()).some((item) => item.id === restored.safetyBackupId && item.type === 'manual'));
  assert.equal((await storage.getCatalog({ admin: true })).projects.some((item) => item.id === projectAfterBackup.id), false);
  await assert.rejects(access(path.join(directory, '.restore')), { code: 'ENOENT' });
  await assert.rejects(() => storage.restoreBackup(preview.token), /kedaluwarsa/);

  await mkdir(path.join(directory, '.restore', 'abandoned'), { recursive: true });
  await writeFile(path.join(directory, '.restore', 'abandoned', 'upload.tar.gz'), 'incomplete');
  await storage.initializeStorage();
  await assert.rejects(access(path.join(directory, '.restore')), { code: 'ENOENT' });

  await storage.deleteBackup(backup.id);
  assert.equal((await storage.listBackups()).some((item) => item.id === backup.id), false);
  await assert.rejects(() => storage.getBackup(backup.id), /tidak ditemukan/);
});

test('menghapus proyek juga menghapus seluruh bagian, halaman, dan file Markdown miliknya', async () => {
  const project = await storage.createProject({ title: 'Proyek Cascade', slug: 'proyek-cascade', description: '', order: 0, published: true });
  const survivor = await storage.createProject({ title: 'Proyek Tetap', slug: 'proyek-tetap', description: '', order: 0, published: true });
  let catalog = await storage.getCatalog({ admin: true });
  const firstSection = catalog.sections.find((item) => item.projectId === project.id);
  const secondSection = await storage.createSection({ projectId: project.id, title: 'Lanjutan', slug: 'lanjutan', order: 0 });
  const survivorSection = catalog.sections.find((item) => item.projectId === survivor.id);
  const firstDocument = await storage.createDocument({ projectId: project.id, sectionId: firstSection.id, title: 'Halaman Satu', slug: 'halaman-satu', excerpt: '', content: '# Satu', order: 0, published: true });
  const secondDocument = await storage.createDocument({ projectId: project.id, sectionId: secondSection.id, title: 'Halaman Dua', slug: 'halaman-dua', excerpt: '', content: '# Dua', order: 0, published: true });
  const survivorDocument = await storage.createDocument({ projectId: survivor.id, sectionId: survivorSection.id, title: 'Tetap Ada', slug: 'tetap-ada', excerpt: '', content: '# Tetap', order: 0, published: true });

  const result = await storage.deleteProject(project.id);
  assert.equal(result.removedSections, 2);
  assert.equal(result.removedDocuments, 2);

  catalog = await storage.getCatalog({ admin: true });
  assert.equal(catalog.projects.some((item) => item.id === project.id), false);
  assert.equal(catalog.sections.some((item) => item.projectId === project.id), false);
  assert.equal(catalog.documents.some((item) => item.projectId === project.id), false);
  await assert.rejects(access(path.join(directory, 'content', project.id)), { code: 'ENOENT' });
  await assert.rejects(() => storage.getDocument(firstDocument.id, { admin: true }), /tidak ditemukan/);
  await assert.rejects(() => storage.getDocument(secondDocument.id, { admin: true }), /tidak ditemukan/);
  assert.equal((await storage.getDocument(survivorDocument.id, { admin: true })).id, survivorDocument.id);
});

test('section tidak dapat dihapus selama masih berisi halaman', async () => {
  const project = await storage.createProject({ title: 'SDK', slug: 'sdk', description: '', order: 1, published: true });
  const section = await storage.createSection({ projectId: project.id, title: 'Dasar', slug: 'dasar', order: 1 });
  const document = await storage.createDocument({ projectId: project.id, sectionId: section.id, title: 'Mulai', slug: 'mulai', excerpt: '', content: '# Mulai', order: 0, published: true });
  await assert.rejects(() => storage.deleteSection(section.id), /Pindahkan atau hapus/);
  await storage.deleteDocument(document.id);
  await storage.deleteSection(section.id);
});

test('item baru ditempatkan terakhir dan katalog dapat diurutkan sekaligus', async () => {
  const project = await storage.createProject({ title: 'Urutan', slug: 'urutan', description: '', order: 0, published: true });
  let catalog = await storage.getCatalog({ admin: true });
  const firstSection = catalog.sections.find((item) => item.projectId === project.id);
  const secondSection = await storage.createSection({ projectId: project.id, title: 'Lanjutan', slug: 'lanjutan', order: 0 });
  const firstDocument = await storage.createDocument({ projectId: project.id, sectionId: firstSection.id, title: 'Pertama', slug: 'pertama', excerpt: '', content: '# Pertama', order: 0, published: true });
  const secondDocument = await storage.createDocument({ projectId: project.id, sectionId: firstSection.id, title: 'Kedua', slug: 'kedua', excerpt: '', content: '# Kedua', order: 0, published: true });
  assert.ok(secondDocument.order > firstDocument.order);

  catalog = await storage.getCatalog({ admin: true });
  const projectIds = catalog.projects.map((item) => item.id).reverse();
  const structures = catalog.projects.map((item) => {
    const projectSections = catalog.sections.filter((section) => section.projectId === item.id);
    if (item.id !== project.id) {
      return { projectId: item.id, sections: projectSections.map((section) => ({ id: section.id, documentIds: catalog.documents.filter((document) => document.sectionId === section.id).map((document) => document.id) })) };
    }
    return {
      projectId: item.id,
      sections: [
        { id: secondSection.id, documentIds: [secondDocument.id] },
        { id: firstSection.id, documentIds: [firstDocument.id] },
      ],
    };
  });

  await storage.reorderCatalog({ projectIds, structures });
  const reordered = await storage.getCatalog({ admin: true });
  assert.deepEqual(reordered.projects.map((item) => item.id), projectIds);
  const navigation = await storage.getNavigation(project.slug);
  assert.deepEqual(navigation.sections.map((item) => item.id), [secondSection.id, firstSection.id]);
  assert.deepEqual(navigation.documents.map((item) => item.id), [secondDocument.id, firstDocument.id]);
  assert.equal(navigation.documents[0].sectionId, secondSection.id);
});

test('media disimpan di luar folder publik dan SVG berbahaya disanitasi', async () => {
  const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4" onload="alert(2)"/></svg>');
  const media = await storage.createMedia({ fileName: 'diagram.svg', mimeType: 'image/svg+xml', buffer: source });
  assert.equal(media.kind, 'image');
  assert.equal((await storage.listMedia()).some((item) => item.id === media.id), true);
  const stored = await storage.getMedia(media.id);
  const contents = await readFile(stored.filePath, 'utf8');
  assert.match(contents, /<svg/);
  assert.doesNotMatch(contents, /script|onload/i);
  const catalog = await storage.getCatalog({ admin: true });
  const project = catalog.projects[0];
  const section = catalog.sections.find((item) => item.projectId === project.id);
  const document = await storage.createDocument({ projectId: project.id, sectionId: section.id, title: 'Media Test', slug: 'media-test', excerpt: '', content: `![Diagram](/media/${media.id})`, order: 0, published: false });
  let inventory = await storage.getMediaInventory();
  const usedMedia = inventory.items.find((item) => item.id === media.id);
  assert.equal(usedMedia.status, 'used');
  assert.equal(usedMedia.usageCount, 1);
  assert.equal(usedMedia.references[0].documentTitle, 'Media Test');
  await assert.rejects(() => storage.deleteMedia(media.id), /masih digunakan/);

  await storage.updateDocument(document.id, { ...document, content: `![Diagram](/media/${media.id})`, published: true });
  assert.equal((await storage.getMediaForViewer(media.id)).id, media.id);

  const unusedMedia = await storage.createMedia({ fileName: 'unused.svg', mimeType: 'image/svg+xml', buffer: source });
  inventory = await storage.getMediaInventory();
  assert.equal(inventory.items.find((item) => item.id === unusedMedia.id).status, 'unused');
  const cleanup = await storage.deleteUnusedMedia();
  assert.equal(cleanup.deleted, 1);
  assert.equal((await storage.listMedia()).some((item) => item.id === media.id), true);
  assert.equal((await storage.listMedia()).some((item) => item.id === unusedMedia.id), false);

  await storage.deleteDocument(document.id);
  await storage.deleteMedia(media.id);
  await assert.rejects(() => storage.getMedia(media.id), /tidak ditemukan/);
});
