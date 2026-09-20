const state = { projects: [], sections: [], documents: [], selectedProjectId: null, csrfToken: '' };
const authLoading = document.querySelector('#auth-loading');
const loginView = document.querySelector('#login-view');
const dashboard = document.querySelector('#dashboard');
const projectDialog = document.querySelector('#project-dialog');
const sectionDialog = document.querySelector('#section-dialog');
const documentDialog = document.querySelector('#document-dialog');
const orderDialog = document.querySelector('#order-dialog');
const mediaDialog = document.querySelector('#media-dialog');
const backupDialog = document.querySelector('#backup-dialog');
const confirmDialog = document.querySelector('#confirm-dialog');
const projectForm = document.querySelector('#project-form');
const sectionForm = document.querySelector('#section-form');
const documentForm = document.querySelector('#document-form');
const orderForm = document.querySelector('#order-form');
let previewTimer;
let orderDraft = null;
let draggedOrderItem = null;
let mediaItems = [];
let mediaSummary = { total: 0, used: 0, unused: 0, missing: 0, orphanFiles: 0, totalBytes: 0, unusedBytes: 0 };
let mediaMode = 'manage';
let backupItems = [];
let restorePreview = null;
let mediaInsertRange = null;
let confirmResolver = null;
let confirmPreviousFocus = null;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function api(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (state.csrfToken && !['GET', 'HEAD'].includes(options.method || 'GET')) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(url, { ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !url.includes('/login')) showLogin();
    throw new Error(body?.error || 'Permintaan gagal.');
  }
  return body;
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

function showToast(message, error = false, duration = 3000) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 z-[100] rounded-md px-4 py-3 text-sm text-white shadow-lg ${error ? 'bg-red-600' : 'bg-slate-950'}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function askConfirmation({ title, message, confirmLabel = 'Konfirmasi', danger = true }) {
  if (confirmResolver) return Promise.resolve(false);
  confirmPreviousFocus = document.activeElement;
  document.querySelector('#confirm-dialog-title').textContent = title;
  document.querySelector('#confirm-dialog-message').textContent = message;
  const accept = document.querySelector('#confirm-accept');
  accept.textContent = confirmLabel;
  accept.className = danger ? 'button-danger' : 'button-primary';
  const icon = document.querySelector('#confirm-dialog-icon');
  icon.className = `mb-4 grid h-10 w-10 place-items-center rounded-full ${danger ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'}`;
  confirmDialog.showModal();
  requestAnimationFrame(() => document.querySelector('#confirm-cancel').focus());
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function resolveConfirmation(value) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmDialog.close();
  confirmPreviousFocus?.focus?.();
  confirmPreviousFocus = null;
  resolve(value);
}

function showLogin() {
  authLoading.classList.add('hidden');
  dashboard.classList.add('hidden');
  loginView.classList.add('grid');
  loginView.classList.remove('hidden');
  document.querySelector('#login-password').value = '';
  requestAnimationFrame(() => document.querySelector('[name="username"]').focus());
}

function showDashboard() {
  authLoading.classList.add('hidden');
  loginView.classList.remove('grid');
  loginView.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

async function refresh() {
  const catalog = await api('/api/admin/catalog');
  state.projects = catalog.projects;
  state.sections = catalog.sections;
  state.documents = catalog.documents;
  if (state.selectedProjectId && !state.projects.some((item) => item.id === state.selectedProjectId)) state.selectedProjectId = null;
  renderProjects();
  renderSections();
  renderDocuments();
}

function renderProjects() {
  const list = document.querySelector('#project-list');
  list.innerHTML = `<button data-project-id="" class="project-row ${state.selectedProjectId === null ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : ''}"><span>Semua proyek</span><span class="text-xs opacity-60">${state.documents.length}</span></button>` + state.projects.map((project) => {
    const count = state.documents.filter((item) => item.projectId === project.id).length;
    const active = state.selectedProjectId === project.id;
    return `<div class="group flex items-center gap-1 rounded-md ${active ? 'bg-slate-900 dark:bg-white' : ''}">
      <button data-project-id="${project.id}" class="project-row min-w-0 flex-1 ${active ? 'text-white hover:bg-transparent hover:text-white dark:text-slate-950 dark:hover:text-slate-950' : ''}"><span class="truncate">${escapeHtml(project.title)}</span><span class="text-xs opacity-60">${count}</span></button>
      <button data-edit-project="${project.id}" class="rounded-md p-2 text-xs ${active ? 'text-slate-300 hover:text-white dark:text-slate-500 dark:hover:text-slate-950' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-white'}" aria-label="Edit proyek">Ubah</button>
    </div>`;
  }).join('');
}

function renderDocuments() {
  const project = state.projects.find((item) => item.id === state.selectedProjectId);
  const items = state.selectedProjectId ? state.documents.filter((item) => item.projectId === state.selectedProjectId) : state.documents;
  document.querySelector('#document-heading').textContent = project?.title || 'Semua halaman';
  document.querySelector('#document-count').textContent = `${items.length} halaman`;
  document.querySelector('#document-list').innerHTML = items.map((item) => {
    const owner = state.projects.find((candidate) => candidate.id === item.projectId);
    const section = state.sections.find((candidate) => candidate.id === item.sectionId);
    return `<article class="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h3 class="truncate font-semibold">${escapeHtml(item.title)}</h3><span class="inline-flex items-center gap-1.5 text-[11px] font-medium ${item.published ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}"><span class="h-1.5 w-1.5 rounded-full ${item.published ? 'bg-emerald-500' : 'bg-amber-500'}"></span>${item.published ? 'Publik' : 'Draft'}</span></div><p class="mt-1 truncate text-xs text-slate-500">${escapeHtml(owner?.title || 'Tanpa proyek')} · ${escapeHtml(section?.title || 'Tanpa bagian')} · /${escapeHtml(item.slug)}</p></div>
      <button data-edit-document="${item.id}" class="button-secondary">Edit</button>
      <button data-delete-document="${item.id}" class="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Hapus</button>
    </article>`;
  }).join('') || '<div class="p-10 text-center text-sm text-slate-500">Belum ada halaman pada proyek ini.</div>';
}

function renderSections() {
  const container = document.querySelector('#section-list');
  if (!state.selectedProjectId) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  const sections = state.sections.filter((item) => item.projectId === state.selectedProjectId);
  container.innerHTML = `<div class="flex flex-wrap items-center gap-x-5 gap-y-2"><span class="text-[11px] font-bold uppercase tracking-widest text-slate-400">Bagian</span>${sections.map((section) => `<button data-edit-section="${section.id}" class="border-b border-transparent py-1 text-xs font-medium text-slate-600 hover:border-slate-400 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white">${escapeHtml(section.title)} <span class="ml-1 text-slate-400">${state.documents.filter((item) => item.sectionId === section.id).length}</span></button>`).join('')}</div>`;
  container.classList.remove('hidden');
}

function projectOptions(selected = '') {
  return state.projects.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('');
}

function fillSectionOptions(projectId, selected = '') {
  const sections = state.sections.filter((item) => item.projectId === projectId);
  documentForm.elements.sectionId.innerHTML = sections.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('');
}

function formObject(form) {
  const values = Object.fromEntries(new FormData(form));
  values.order = Number(values.order);
  if (form.elements.published) values.published = form.elements.published.checked;
  return values;
}

function updateMarkdownCount() {
  const length = documentForm.elements.content.value.length;
  document.querySelector('#markdown-count').textContent = `${new Intl.NumberFormat('id-ID').format(length)} karakter`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}

function formatBackupDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak diketahui';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function backupOperationLabel(backup) {
  if (backup.type === 'manual') return 'Backup lengkap';
  const labels = {
    'create-project': 'Sebelum membuat proyek',
    'update-project': 'Sebelum mengubah proyek',
    'delete-project': 'Sebelum menghapus proyek',
    'create-section': 'Sebelum membuat bagian',
    'update-section': 'Sebelum mengubah bagian',
    'delete-section': 'Sebelum menghapus bagian',
    'create-document': 'Sebelum membuat halaman',
    'update-document': 'Sebelum mengubah halaman',
    'delete-document': 'Sebelum menghapus halaman',
    'reorder-catalog': 'Sebelum mengubah urutan',
    'upload-media': 'Sebelum mengunggah media',
    'delete-media': 'Sebelum menghapus media',
    'delete-unused-media': 'Sebelum membersihkan media',
    'migrate-sections': 'Sebelum migrasi bagian',
  };
  return labels[backup.operation] || 'Snapshot otomatis';
}

function setBackupStatus(message = '', error = false) {
  const status = document.querySelector('#backup-status');
  status.textContent = message;
  status.className = `mt-4 rounded-md px-4 py-3 text-sm ${message ? '' : 'hidden'} ${error ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`;
}

function renderBackups(retention) {
  const automaticCount = backupItems.filter((item) => item.type === 'automatic').length;
  document.querySelector('#backup-count').textContent = `${backupItems.length} backup · ${automaticCount} dari maksimal ${retention} snapshot otomatis`;
  document.querySelector('#backup-list').innerHTML = backupItems.map((backup) => `<article class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
    <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h4 class="font-semibold text-slate-900 dark:text-white">${escapeHtml(backupOperationLabel(backup))}</h4><span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${backup.type === 'manual' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}">${backup.type === 'manual' ? 'Manual' : 'Otomatis'}</span></div><p class="mt-1 text-xs text-slate-500">${escapeHtml(formatBackupDate(backup.createdAt))} · ${formatBytes(backup.size)}</p></div>
    <div class="flex shrink-0 items-center gap-2"><a href="/api/admin/backups/${encodeURIComponent(backup.id)}/download" class="button-secondary px-3 py-1.5" download>Unduh</a><button type="button" data-delete-backup="${escapeHtml(backup.id)}" class="px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Hapus</button></div>
  </article>`).join('') || '<div class="py-10 text-center text-sm text-slate-500">Belum ada backup.</div>';
}

function clearRestorePreview() {
  restorePreview = null;
  document.querySelector('#restore-input').value = '';
  document.querySelector('#restore-preview').classList.add('hidden');
  document.querySelector('#restore-actions').classList.remove('hidden');
  document.querySelector('#restore-confirmation').classList.add('hidden');
  document.querySelector('#restore-summary').textContent = '';
}

function renderRestorePreview(preview) {
  restorePreview = preview;
  document.querySelector('#restore-actions').classList.remove('hidden');
  document.querySelector('#restore-confirmation').classList.add('hidden');
  document.querySelector('#restore-summary').textContent = `${preview.projects} proyek, ${preview.sections} bagian, ${preview.documents} halaman, dan ${preview.media} media · dibuat ${formatBackupDate(preview.sourceCreatedAt)} · ${formatBytes(preview.compressedSize)}`;
  document.querySelector('#restore-preview').classList.remove('hidden');
}

async function loadBackups() {
  const result = await api('/api/admin/backups');
  backupItems = result.items;
  document.querySelector('#restore-limit').textContent = `${Math.floor(result.maxRestoreBytes / 1024 / 1024)} MB`;
  renderBackups(result.retention);
}

async function openBackupManager() {
  setBackupStatus();
  clearRestorePreview();
  backupDialog.showModal();
  try { await loadBackups(); } catch (error) { setBackupStatus(error.message, true); }
}

async function discardRestorePreview() {
  const token = restorePreview?.token;
  clearRestorePreview();
  if (!token) return;
  try { await api(`/api/admin/backups/restore/${encodeURIComponent(token)}`, { method: 'DELETE' }); } catch { /* Kedaluwarsa akan dibersihkan server. */ }
}

function mediaSnippet(media) {
  const label = media.originalName.replace(/[\[\]]/g, '');
  const title = escapeHtml(media.originalName);
  if (media.kind === 'image') return `![${label}](/media/${media.id})`;
  if (media.kind === 'video') return `<video controls preload="metadata" src="/media/${media.id}"></video>`;
  if (media.kind === 'pdf') return `<iframe src="/media/${media.id}" title="${title}"></iframe>`;
  return `[Unduh ${label}](/media/${media.id})`;
}

function setMediaStatus(message = '', error = false) {
  const status = document.querySelector('#media-status');
  status.textContent = message;
  status.className = `mt-4 rounded-md px-4 py-3 text-sm ${message ? '' : 'hidden'} ${error ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`;
}

function renderMedia() {
  const query = document.querySelector('#media-search').value.trim().toLocaleLowerCase('id');
  const filter = document.querySelector('#media-filter').value;
  const filtered = mediaItems.filter((item) => {
    const matchesQuery = item.originalName.toLocaleLowerCase('id').includes(query);
    const matchesFilter = filter === 'all'
      || (filter === 'used' && item.usageCount > 0)
      || (filter === 'unused' && item.usageCount === 0 && item.fileExists)
      || (filter === 'missing' && !item.fileExists);
    return matchesQuery && matchesFilter;
  });
  document.querySelector('#media-count').textContent = `${filtered.length} dari ${mediaItems.length} file`;
  document.querySelector('#media-list').innerHTML = filtered.map((media) => {
    const preview = media.kind === 'image' && media.fileExists
      ? `<img src="/media/${media.id}" alt="" loading="lazy" class="h-28 w-full object-contain">`
      : `<div class="grid h-28 place-items-center bg-slate-100 text-sm font-semibold uppercase text-slate-500 dark:bg-slate-800">${!media.fileExists ? 'File hilang' : media.kind === 'video' ? 'Video' : media.kind === 'pdf' ? 'PDF' : 'File'}</div>`;
    const usageLabel = media.usageCount
      ? `Dipakai ${media.usageCount} halaman`
      : media.fileExists ? 'Tidak digunakan' : 'File fisik hilang';
    const usageClass = media.usageCount
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
      : media.fileExists ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300';
    const referenceTitles = media.references.slice(0, 2).map((reference) => `${escapeHtml(reference.documentTitle)} · ${escapeHtml(reference.projectTitle)}`).join('<br>');
    const usageDetail = referenceTitles ? `<p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-500" title="${escapeHtml(media.references.map((reference) => reference.documentTitle).join(', '))}">${referenceTitles}${media.references.length > 2 ? '<br>dan lainnya' : ''}</p>` : '';
    const insertButton = mediaMode === 'insert' && media.fileExists ? `<button type="button" data-insert-media="${media.id}" class="button-primary px-3 py-1.5">Sisipkan</button>` : '';
    const deleteAttributes = media.usageCount ? 'disabled aria-disabled="true" title="Media masih digunakan"' : '';
    return `<article class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">${preview}<div class="border-t border-slate-200 p-3 dark:border-slate-800"><div class="flex items-start justify-between gap-2"><h4 class="min-w-0 truncate text-sm font-medium" title="${escapeHtml(media.originalName)}">${escapeHtml(media.originalName)}</h4><span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${usageClass}">${usageLabel}</span></div><p class="mt-1 text-xs text-slate-500">${formatBytes(media.size)}</p>${usageDetail}<div class="mt-3 flex flex-wrap gap-2">${insertButton}<button type="button" data-copy-media="${media.id}" class="button-secondary px-3 py-1.5" ${media.fileExists ? '' : 'disabled'}>Salin URL</button><button type="button" data-delete-media="${media.id}" ${deleteAttributes} class="ml-auto px-2 py-1.5 text-xs font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">Hapus</button></div></div></article>`;
  }).join('') || '<div class="col-span-full border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Tidak ada media yang cocok.</div>';
}

async function loadMedia() {
  const result = await api('/api/admin/media');
  mediaItems = result.items;
  mediaSummary = result.summary;
  document.querySelector('#media-limit').textContent = `${Math.floor(result.maxUploadBytes / 1024 / 1024)} MB`;
  document.querySelector('#media-total-size').textContent = formatBytes(mediaSummary.totalBytes);
  document.querySelector('#media-used-count').textContent = `${mediaSummary.used} file`;
  document.querySelector('#media-unused-count').textContent = `${mediaSummary.unused} file · ${formatBytes(mediaSummary.unusedBytes)}`;
  const cleanup = document.querySelector('#delete-unused-media');
  cleanup.classList.toggle('hidden', mediaMode !== 'manage' || mediaSummary.unused === 0);
  cleanup.textContent = `Hapus ${mediaSummary.unused} file tidak digunakan`;
  renderMedia();
  if (mediaSummary.orphanFiles) setMediaStatus(`${mediaSummary.orphanFiles} file fisik tidak terdaftar ditemukan. File tersebut tidak ditampilkan dan perlu diperiksa dari storage.`, true);
}

async function openMediaLibrary(mode = 'manage') {
  mediaMode = mode;
  if (mode === 'insert') {
    const editor = documentForm.elements.content;
    mediaInsertRange = { start: editor.selectionStart, end: editor.selectionEnd };
  } else {
    mediaInsertRange = null;
  }
  setMediaStatus();
  document.querySelector('#media-search').value = '';
  document.querySelector('#media-filter').value = 'all';
  document.querySelector('#media-dialog-description').textContent = mode === 'insert'
    ? 'Pilih file untuk disisipkan pada posisi kursor atau unggah file baru.'
    : 'Kelola penggunaan gambar, video, dokumen, dan lampiran dalam satu tempat.';
  document.querySelector('#media-embed-tools').classList.toggle('hidden', mode !== 'insert');
  mediaDialog.showModal();
  try { await loadMedia(); } catch (error) { setMediaStatus(error.message, true); }
}

async function uploadMediaFiles(files) {
  const queue = [...files];
  let uploaded = 0;
  try {
    for (const [index, file] of queue.entries()) {
      setMediaStatus(`Mengunggah ${index + 1} dari ${queue.length}: ${file.name}`);
      const response = await fetch('/api/admin/media', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': file.type || 'application/octet-stream',
          'X-CSRF-Token': state.csrfToken,
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Gagal mengunggah ${file.name}.`);
      uploaded += 1;
    }
  } finally {
    if (uploaded) await loadMedia();
  }
  setMediaStatus(`${queue.length} file berhasil diunggah.`);
}

function insertEditorSnippet(snippet) {
  const editor = documentForm.elements.content;
  const start = mediaInsertRange?.start ?? editor.selectionStart;
  const end = mediaInsertRange?.end ?? editor.selectionEnd;
  const prefix = start > 0 && !editor.value.slice(0, start).endsWith('\n\n') ? '\n\n' : '';
  const suffix = end < editor.value.length && !editor.value.slice(end).startsWith('\n\n') ? '\n\n' : '';
  const insertion = `${prefix}${snippet}${suffix}`;
  editor.setRangeText(insertion, start, end, 'end');
  mediaInsertRange = { start: start + insertion.length, end: start + insertion.length };
  updateMarkdownCount();
  updatePreview();
}

function insertMedia(media) {
  if (mediaMode !== 'insert' || !media) return;
  insertEditorSnippet(mediaSnippet(media));
  setMediaStatus(`“${media.originalName}” disisipkan ke editor.`);
}

function normalizeVideoEmbed(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return /^[a-zA-Z0-9_-]{6,}$/.test(id || '') ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'www.youtube-nocookie.com') {
    const id = url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
    return /^[a-zA-Z0-9_-]{6,}$/.test(id || '') ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).findLast((part) => /^\d+$/.test(part));
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}

function moveArrayItem(items, id, direction) {
  const index = items.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return false;
  [items[index], items[target]] = [items[target], items[index]];
  return true;
}

function orderButton(direction, kind, id, disabled = false) {
  const label = direction === 'up' ? 'Naikkan' : 'Turunkan';
  const symbol = direction === 'up' ? '↑' : '↓';
  return `<button type="button" data-order-move="${direction}" data-order-kind="${kind}" data-order-id="${id}" ${disabled ? 'disabled' : ''} class="icon-button h-8 w-8 text-sm disabled:cursor-not-allowed disabled:opacity-25" aria-label="${label} item">${symbol}</button>`;
}

function createOrderDraft() {
  return {
    projectIds: state.projects.map((project) => project.id),
    structures: state.projects.map((project) => ({
      projectId: project.id,
      sections: state.sections.filter((section) => section.projectId === project.id).map((section) => ({
        id: section.id,
        documentIds: state.documents.filter((document) => document.projectId === project.id && document.sectionId === section.id).map((document) => document.id),
      })),
    })),
    activeProjectId: state.selectedProjectId || state.projects[0]?.id || null,
    dirty: false,
  };
}

function activeOrderStructure() {
  return orderDraft?.structures.find((structure) => structure.projectId === orderDraft.activeProjectId);
}

function markOrderDirty() {
  orderDraft.dirty = true;
  document.querySelector('#order-status').textContent = 'Ada perubahan yang belum disimpan.';
  document.querySelector('#save-order').disabled = false;
}

function renderOrderManager() {
  const projectList = document.querySelector('#order-project-list');
  projectList.innerHTML = orderDraft.projectIds.map((id, index) => {
    const project = state.projects.find((item) => item.id === id);
    const active = id === orderDraft.activeProjectId;
    return `<div draggable="true" data-order-kind="project" data-order-id="${id}" class="flex cursor-grab items-center gap-2 rounded-md border px-2 py-2 active:cursor-grabbing ${active ? 'border-slate-900 bg-slate-50 dark:border-slate-500 dark:bg-slate-800' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}">
      <span class="select-none text-slate-400" aria-hidden="true">⋮⋮</span><button type="button" data-order-project="${id}" class="min-w-0 flex-1 truncate text-left text-sm font-medium">${escapeHtml(project.title)}</button>
      <span class="flex shrink-0">${orderButton('up', 'project', id, index === 0)}${orderButton('down', 'project', id, index === orderDraft.projectIds.length - 1)}</span>
    </div>`;
  }).join('') || '<p class="text-sm text-slate-500">Belum ada proyek.</p>';

  const structure = activeOrderStructure();
  const project = state.projects.find((item) => item.id === orderDraft.activeProjectId);
  document.querySelector('#order-structure-title').textContent = project?.title || 'Pilih proyek';
  const container = document.querySelector('#order-structure');
  if (!structure) {
    container.innerHTML = '<p class="border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Buat proyek terlebih dahulu.</p>';
    return;
  }

  container.innerHTML = structure.sections.map((sectionDraft, sectionIndex) => {
    const section = state.sections.find((item) => item.id === sectionDraft.id);
    const pages = sectionDraft.documentIds.map((id) => state.documents.find((item) => item.id === id)).filter(Boolean);
    return `<section draggable="true" data-order-kind="section" data-order-id="${section.id}" class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div class="flex cursor-grab items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5 active:cursor-grabbing dark:border-slate-800 dark:bg-slate-950/50">
        <span class="select-none text-slate-400" aria-hidden="true">⋮⋮</span><div class="min-w-0 flex-1"><h4 class="truncate text-sm font-semibold">${escapeHtml(section.title)}</h4><p class="text-xs text-slate-500">${pages.length} halaman</p></div>
        <span class="flex shrink-0">${orderButton('up', 'section', section.id, sectionIndex === 0)}${orderButton('down', 'section', section.id, sectionIndex === structure.sections.length - 1)}</span>
      </div>
      <div data-document-zone="${section.id}" class="min-h-14 divide-y divide-slate-100 p-2 dark:divide-slate-800">${pages.map((page, pageIndex) => `<div draggable="true" data-order-kind="document" data-order-id="${page.id}" data-section-id="${section.id}" class="flex cursor-grab items-center gap-3 rounded-md px-2 py-2.5 hover:bg-slate-50 active:cursor-grabbing dark:hover:bg-slate-800/60">
          <span class="select-none text-slate-400" aria-hidden="true">⋮⋮</span><span class="min-w-0 flex-1 truncate text-sm">${escapeHtml(page.title)}</span><span class="text-[11px] ${page.published ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}">${page.published ? 'Publik' : 'Draft'}</span>
          <span class="flex shrink-0">${orderButton('up', 'document', page.id, sectionIndex === 0 && pageIndex === 0)}${orderButton('down', 'document', page.id, sectionIndex === structure.sections.length - 1 && pageIndex === pages.length - 1)}</span>
        </div>`).join('') || '<p class="p-3 text-center text-xs text-slate-400">Letakkan halaman di sini</p>'}</div>
    </section>`;
  }).join('') || '<p class="border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Proyek ini belum memiliki bagian.</p>';
}

function openOrderManager() {
  orderDraft = createOrderDraft();
  document.querySelector('#order-status').textContent = 'Belum ada perubahan.';
  document.querySelector('#save-order').disabled = true;
  renderOrderManager();
  orderDialog.showModal();
}

function moveOrderItem(kind, id, direction) {
  const step = direction === 'up' ? -1 : 1;
  if (kind === 'project') return moveArrayItem(orderDraft.projectIds, id, step);
  const structure = activeOrderStructure();
  if (kind === 'section') return moveArrayItem(structure.sections.map((item) => item.id), id, step) && (() => {
    const index = structure.sections.findIndex((item) => item.id === id);
    const target = index + step;
    [structure.sections[index], structure.sections[target]] = [structure.sections[target], structure.sections[index]];
    return true;
  })();
  if (kind === 'document') {
    const sectionIndex = structure.sections.findIndex((section) => section.documentIds.includes(id));
    const section = structure.sections[sectionIndex];
    const pageIndex = section.documentIds.indexOf(id);
    if (step < 0 && pageIndex > 0) return moveArrayItem(section.documentIds, id, -1);
    if (step > 0 && pageIndex < section.documentIds.length - 1) return moveArrayItem(section.documentIds, id, 1);
    const targetSection = structure.sections[sectionIndex + step];
    if (!targetSection) return false;
    section.documentIds.splice(pageIndex, 1);
    step < 0 ? targetSection.documentIds.push(id) : targetSection.documentIds.unshift(id);
    return true;
  }
  return false;
}

function placeDraggedItem(targetKind, targetId, targetSectionId = null) {
  if (!draggedOrderItem || draggedOrderItem.kind !== targetKind || draggedOrderItem.id === targetId) return false;
  if (targetKind === 'project') {
    const from = orderDraft.projectIds.indexOf(draggedOrderItem.id);
    const target = orderDraft.projectIds.indexOf(targetId);
    orderDraft.projectIds.splice(from, 1);
    orderDraft.projectIds.splice(orderDraft.projectIds.indexOf(targetId), 0, draggedOrderItem.id);
    return from !== target;
  }
  const structure = activeOrderStructure();
  if (targetKind === 'section') {
    const from = structure.sections.findIndex((item) => item.id === draggedOrderItem.id);
    const item = structure.sections.splice(from, 1)[0];
    structure.sections.splice(structure.sections.findIndex((entry) => entry.id === targetId), 0, item);
    return true;
  }
  const source = structure.sections.find((section) => section.documentIds.includes(draggedOrderItem.id));
  const destination = structure.sections.find((section) => section.id === targetSectionId);
  if (!source || !destination) return false;
  source.documentIds.splice(source.documentIds.indexOf(draggedOrderItem.id), 1);
  const targetIndex = targetId ? destination.documentIds.indexOf(targetId) : destination.documentIds.length;
  destination.documentIds.splice(targetIndex < 0 ? destination.documentIds.length : targetIndex, 0, draggedOrderItem.id);
  return true;
}

function clearOrderDropTargets() {
  document.querySelectorAll('[data-order-drop-active]').forEach((element) => {
    delete element.dataset.orderDropActive;
    element.classList.remove('ring-2', 'ring-indigo-400');
  });
}

function openSection(section = null) {
  if (!state.projects.length) return showToast('Buat proyek terlebih dahulu.', true);
  sectionForm.reset();
  sectionForm.elements.id.value = section?.id || '';
  sectionForm.elements.projectId.innerHTML = projectOptions(section?.projectId || state.selectedProjectId || state.projects[0].id);
  sectionForm.elements.title.value = section?.title || '';
  sectionForm.elements.slug.value = section?.slug || '';
  sectionForm.elements.order.value = section?.order ?? 0;
  document.querySelector('#section-dialog-title').textContent = section ? 'Edit bagian' : 'Tambah bagian';
  document.querySelector('#delete-section').classList.toggle('hidden', !section);
  setFormError(sectionForm);
  sectionDialog.showModal();
}

function setFormError(form, message = '') {
  const element = form.querySelector('[data-form-error]');
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function openProject(project = null) {
  projectForm.reset();
  projectForm.elements.id.value = project?.id || '';
  projectForm.elements.title.value = project?.title || '';
  projectForm.elements.slug.value = project?.slug || '';
  projectForm.elements.description.value = project?.description || '';
  projectForm.elements.order.value = project?.order ?? 0;
  projectForm.elements.published.checked = project?.published ?? true;
  document.querySelector('#project-dialog-title').textContent = project ? 'Edit proyek' : 'Tambah proyek';
  document.querySelector('#delete-project').classList.toggle('hidden', !project);
  setFormError(projectForm);
  projectDialog.showModal();
}

async function openDocument(item = null) {
  if (!state.projects.length) return showToast('Buat proyek terlebih dahulu.', true);
  documentForm.reset();
  let detail = item;
  if (item) detail = await api(`/api/admin/documents/${item.id}`);
  documentForm.elements.id.value = detail?.id || '';
  const projectId = detail?.projectId || state.selectedProjectId || state.projects[0].id;
  documentForm.elements.projectId.innerHTML = projectOptions(projectId);
  fillSectionOptions(projectId, detail?.sectionId);
  documentForm.elements.title.value = detail?.title || '';
  documentForm.elements.slug.value = detail?.slug || '';
  documentForm.elements.excerpt.value = detail?.excerpt || '';
  documentForm.elements.order.value = detail?.order ?? 0;
  documentForm.elements.published.checked = detail?.published ?? true;
  documentForm.elements.content.value = detail?.content || '# Judul halaman\n\nMulai menulis dokumentasi di sini.';
  updateMarkdownCount();
  document.querySelector('#document-dialog-title').textContent = detail ? 'Edit halaman' : 'Tambah halaman';
  setFormError(documentForm);
  documentDialog.showModal();
  updatePreview();
}

async function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const result = await api('/api/admin/preview', { method: 'POST', body: JSON.stringify({ content: documentForm.elements.content.value }) });
      document.querySelector('#markdown-preview').innerHTML = result.html;
    } catch {
      document.querySelector('#markdown-preview').innerHTML = '<p class="text-red-500">Preview tidak dapat dimuat.</p>';
    }
  }, 250);
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#login-error');
  const button = document.querySelector('#login-button');
  error.classList.add('hidden');
  error.textContent = '';
  event.currentTarget.elements.username.removeAttribute('aria-invalid');
  event.currentTarget.elements.password.removeAttribute('aria-invalid');
  button.disabled = true;
  button.textContent = 'Memeriksa…';
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    state.csrfToken = result.csrfToken;
    await refresh();
    showDashboard();
  } catch (exception) {
    state.csrfToken = '';
    error.textContent = exception.message;
    error.classList.remove('hidden');
    event.currentTarget.elements.username.setAttribute('aria-invalid', 'true');
    event.currentTarget.elements.password.setAttribute('aria-invalid', 'true');
    event.currentTarget.elements.password.focus();
  } finally {
    button.disabled = false;
    button.textContent = 'Masuk';
  }
});

const loginPassword = document.querySelector('#login-password');
const toggleLoginPassword = document.querySelector('#toggle-login-password');
const loginCapsLock = document.querySelector('#login-caps-lock');
toggleLoginPassword.addEventListener('click', () => {
  const visible = loginPassword.type === 'text';
  loginPassword.type = visible ? 'password' : 'text';
  toggleLoginPassword.textContent = visible ? 'Lihat' : 'Sembunyikan';
  toggleLoginPassword.setAttribute('aria-pressed', String(!visible));
  loginPassword.focus();
});
for (const eventName of ['keydown', 'keyup']) {
  loginPassword.addEventListener(eventName, (event) => loginCapsLock.classList.toggle('hidden', !event.getModifierState('CapsLock')));
}
loginPassword.addEventListener('blur', () => loginCapsLock.classList.add('hidden'));

document.querySelector('#logout-button').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  state.csrfToken = '';
  showLogin();
});

document.querySelector('#admin-theme-button').addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('docs-theme', dark ? 'dark' : 'light');
});

document.querySelector('#new-project').addEventListener('click', () => openProject());
document.querySelector('#new-section').addEventListener('click', () => openSection());
document.querySelector('#new-document').addEventListener('click', () => openDocument());
document.querySelector('#reorder-content').addEventListener('click', openOrderManager);
document.querySelector('#open-backups').addEventListener('click', openBackupManager);
document.querySelector('#open-media-manager').addEventListener('click', () => openMediaLibrary('manage'));
document.querySelector('#open-media-library').addEventListener('click', () => openMediaLibrary('insert'));
document.querySelector('#confirm-cancel').addEventListener('click', () => resolveConfirmation(false));
document.querySelector('#confirm-accept').addEventListener('click', () => resolveConfirmation(true));
confirmDialog.addEventListener('cancel', (event) => { event.preventDefault(); resolveConfirmation(false); });
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', async () => {
  const dialog = document.querySelector(`#${button.dataset.closeDialog}`);
  if (dialog === orderDialog && orderDraft?.dirty) {
    const confirmed = await askConfirmation({ title: 'Batalkan perubahan?', message: 'Urutan yang belum disimpan akan hilang.', confirmLabel: 'Batalkan perubahan', danger: false });
    if (!confirmed) return;
    orderDraft.dirty = false;
  }
  if (dialog === backupDialog && restorePreview) await discardRestorePreview();
  dialog.close();
}));

document.querySelector('#media-input').addEventListener('change', async (event) => {
  if (!event.target.files.length) return;
  try { await uploadMediaFiles(event.target.files); } catch (error) { setMediaStatus(error.message, true); }
  event.target.value = '';
});

const mediaDropZone = document.querySelector('#media-drop-zone');
for (const eventName of ['dragenter', 'dragover']) {
  mediaDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    mediaDropZone.classList.add('border-indigo-500', 'bg-indigo-50', 'dark:bg-indigo-950/30');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  mediaDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    mediaDropZone.classList.remove('border-indigo-500', 'bg-indigo-50', 'dark:bg-indigo-950/30');
  });
}
mediaDropZone.addEventListener('drop', async (event) => {
  if (!event.dataTransfer.files.length) return;
  try { await uploadMediaFiles(event.dataTransfer.files); } catch (error) { setMediaStatus(error.message, true); }
});

mediaDialog.addEventListener('close', () => {
  const editor = documentForm.elements.content;
  if (!documentDialog.open || !mediaInsertRange) return;
  editor.focus();
  editor.setSelectionRange(mediaInsertRange.start, mediaInsertRange.end);
});
backupDialog.addEventListener('cancel', (event) => {
  if (!restorePreview) return;
  event.preventDefault();
  void discardRestorePreview().finally(() => backupDialog.close());
});

document.querySelector('#media-search').addEventListener('input', renderMedia);
document.querySelector('#media-filter').addEventListener('change', renderMedia);
document.querySelector('#insert-embed').addEventListener('click', () => {
  const input = document.querySelector('#embed-url');
  const source = normalizeVideoEmbed(input.value.trim());
  if (!source) return setMediaStatus('Gunakan URL video YouTube atau Vimeo yang valid.', true);
  insertEditorSnippet(`<iframe src="${source}" title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`);
  input.value = '';
  setMediaStatus('Video disisipkan ke editor.');
});

document.querySelector('#media-list').addEventListener('click', async (event) => {
  const insert = event.target.closest('[data-insert-media]');
  if (insert) return insertMedia(mediaItems.find((item) => item.id === insert.dataset.insertMedia));
  const copy = event.target.closest('[data-copy-media]');
  if (copy) {
    const url = `${location.origin}/media/${copy.dataset.copyMedia}`;
    try { await navigator.clipboard.writeText(url); setMediaStatus('URL media disalin.'); } catch { setMediaStatus('Browser tidak mengizinkan akses clipboard.', true); }
    return;
  }
  const remove = event.target.closest('[data-delete-media]');
  if (!remove) return;
  const media = mediaItems.find((item) => item.id === remove.dataset.deleteMedia);
  if (!media) return;
  if (media.usageCount) {
    const titles = media.references.slice(0, 3).map((reference) => reference.documentTitle).join(', ');
    return setMediaStatus(`Media masih digunakan oleh halaman: ${titles}${media.usageCount > 3 ? ', dan lainnya' : ''}.`, true);
  }
  if (mediaMode === 'insert' && documentForm.elements.content.value.includes(`/media/${media.id}`)) return setMediaStatus('Media masih digunakan pada halaman yang sedang diedit dan belum disimpan.', true);
  const confirmed = await askConfirmation({ title: 'Hapus media?', message: `“${media.originalName}” akan dihapus dari Media Library.`, confirmLabel: 'Hapus media' });
  if (!confirmed) return;
  try {
    await api(`/api/admin/media/${media.id}`, { method: 'DELETE' });
    await loadMedia();
    setMediaStatus('Media dihapus.');
  } catch (error) { setMediaStatus(error.message, true); }
});

document.querySelector('#delete-unused-media').addEventListener('click', async () => {
  if (!mediaSummary.unused) return;
  const confirmed = await askConfirmation({
    title: `Hapus ${mediaSummary.unused} file tidak digunakan?`,
    message: `${formatBytes(mediaSummary.unusedBytes)} penyimpanan akan dibebaskan. Server akan memeriksa ulang semua halaman sebelum menghapus dan membuat snapshot otomatis.`,
    confirmLabel: 'Hapus file',
  });
  if (!confirmed) return;
  const button = document.querySelector('#delete-unused-media');
  button.disabled = true;
  button.textContent = 'Memeriksa dan menghapus…';
  try {
    const result = await api('/api/admin/media/unused', { method: 'DELETE' });
    await loadMedia();
    setMediaStatus(`${result.deleted} file tidak digunakan dihapus. ${formatBytes(result.freedBytes)} penyimpanan dibebaskan.`);
  } catch (error) {
    setMediaStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#create-backup').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Membuat backup…';
  setBackupStatus('Menyalin data. Jangan tutup halaman ini terlebih dahulu.');
  try {
    await api('/api/admin/backups', { method: 'POST' });
    await loadBackups();
    setBackupStatus('Backup lengkap berhasil dibuat.');
  } catch (error) { setBackupStatus(error.message, true); }
  finally {
    button.disabled = false;
    button.textContent = 'Buat backup sekarang';
  }
});

document.querySelector('#backup-list').addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-delete-backup]');
  if (!remove) return;
  const backup = backupItems.find((item) => item.id === remove.dataset.deleteBackup);
  if (!backup) return;
  const confirmed = await askConfirmation({ title: 'Hapus backup?', message: `${backupOperationLabel(backup)} dari ${formatBackupDate(backup.createdAt)} akan dihapus permanen.`, confirmLabel: 'Hapus backup' });
  if (!confirmed) return;
  try {
    await api(`/api/admin/backups/${encodeURIComponent(backup.id)}`, { method: 'DELETE' });
    await loadBackups();
    setBackupStatus('Backup dihapus.');
  } catch (error) { setBackupStatus(error.message, true); }
});

document.querySelector('#restore-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!/\.(?:tar\.gz|tgz)$/i.test(file.name)) {
    clearRestorePreview();
    return setBackupStatus('Pilih file backup dengan ekstensi .tar.gz atau .tgz.', true);
  }
  if (restorePreview) await discardRestorePreview();
  event.target.value = '';
  event.target.disabled = true;
  setBackupStatus('Mengunggah dan memeriksa backup…');
  try {
    const response = await fetch('/api/admin/backups/restore/inspect', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/gzip', 'X-CSRF-Token': state.csrfToken },
      body: file,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Backup tidak dapat diperiksa.');
    renderRestorePreview(body);
    setBackupStatus('Backup valid. Periksa ringkasan sebelum memulihkan data.');
  } catch (error) {
    clearRestorePreview();
    setBackupStatus(error.message, true);
  } finally { event.target.disabled = false; }
});

document.querySelector('#cancel-restore').addEventListener('click', async () => {
  await discardRestorePreview();
  setBackupStatus('Restore dibatalkan.');
});

document.querySelector('#apply-restore').addEventListener('click', () => {
  if (!restorePreview) return;
  document.querySelector('#restore-actions').classList.add('hidden');
  document.querySelector('#restore-confirmation').classList.remove('hidden');
  document.querySelector('#confirm-restore').focus();
});

document.querySelector('#cancel-restore-confirmation').addEventListener('click', () => {
  document.querySelector('#restore-confirmation').classList.add('hidden');
  document.querySelector('#restore-actions').classList.remove('hidden');
  document.querySelector('#apply-restore').focus();
});

document.querySelector('#confirm-restore').addEventListener('click', async (event) => {
  if (!restorePreview) return;
  const preview = restorePreview;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Memulihkan…';
  setBackupStatus('Memulihkan data. Jangan tutup halaman ini.');
  try {
    await api('/api/admin/backups/restore/apply', { method: 'POST', body: JSON.stringify({ token: preview.token }) });
    clearRestorePreview();
    backupDialog.close();
    showToast('Restore berhasil. Data telah dipulihkan dan backup pengaman dibuat.', false, 6000);
    try {
      await refresh();
    } catch {
      showToast('Restore berhasil, tetapi tampilan belum dapat dimuat ulang. Segarkan halaman.', true, 6000);
    }
  } catch (error) {
    setBackupStatus(`Restore gagal: ${error.message}`, true);
    document.querySelector('#backup-status').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  finally {
    button.disabled = false;
    button.textContent = 'Ya, pulihkan sekarang';
  }
});

orderDialog.addEventListener('cancel', async (event) => {
  if (!orderDraft?.dirty) return;
  event.preventDefault();
  const confirmed = await askConfirmation({ title: 'Batalkan perubahan?', message: 'Urutan yang belum disimpan akan hilang.', confirmLabel: 'Batalkan perubahan', danger: false });
  if (confirmed) {
    orderDraft.dirty = false;
    orderDialog.close();
  }
});

orderDialog.addEventListener('click', (event) => {
  const project = event.target.closest('[data-order-project]');
  if (project) {
    orderDraft.activeProjectId = project.dataset.orderProject;
    renderOrderManager();
    return;
  }
  const move = event.target.closest('[data-order-move]');
  if (move && moveOrderItem(move.dataset.orderKind, move.dataset.orderId, move.dataset.orderMove)) {
    markOrderDirty();
    renderOrderManager();
  }
});

orderDialog.addEventListener('dragstart', (event) => {
  const item = event.target.closest('[data-order-kind]');
  if (!item) return;
  draggedOrderItem = { kind: item.dataset.orderKind, id: item.dataset.orderId };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', item.dataset.orderId);
  requestAnimationFrame(() => item.classList.add('opacity-40'));
});

orderDialog.addEventListener('dragover', (event) => {
  if (!draggedOrderItem) return;
  let target;
  if (draggedOrderItem.kind === 'document') target = event.target.closest('[data-order-kind="document"], [data-document-zone]');
  else target = event.target.closest(`[data-order-kind="${draggedOrderItem.kind}"]`);
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearOrderDropTargets();
  target.dataset.orderDropActive = 'true';
  target.classList.add('ring-2', 'ring-indigo-400');
});

orderDialog.addEventListener('drop', (event) => {
  if (!draggedOrderItem) return;
  event.preventDefault();
  let changed = false;
  if (draggedOrderItem.kind === 'document') {
    const targetDocument = event.target.closest('[data-order-kind="document"]');
    const zone = event.target.closest('[data-document-zone]');
    changed = placeDraggedItem('document', targetDocument?.dataset.orderId || null, targetDocument?.dataset.sectionId || zone?.dataset.documentZone);
  } else {
    const target = event.target.closest(`[data-order-kind="${draggedOrderItem.kind}"]`);
    if (target) changed = placeDraggedItem(draggedOrderItem.kind, target.dataset.orderId);
  }
  clearOrderDropTargets();
  draggedOrderItem = null;
  if (changed) {
    markOrderDirty();
    renderOrderManager();
  }
});

orderDialog.addEventListener('dragend', (event) => {
  event.target.closest('[data-order-kind]')?.classList.remove('opacity-40');
  draggedOrderItem = null;
  clearOrderDropTargets();
});

document.querySelector('#project-list').addEventListener('click', (event) => {
  const selector = event.target.closest('[data-project-id]');
  if (selector) {
    state.selectedProjectId = selector.dataset.projectId || null;
    renderProjects();
    renderSections();
    renderDocuments();
  }
  const edit = event.target.closest('[data-edit-project]');
  if (edit) openProject(state.projects.find((item) => item.id === edit.dataset.editProject));
});

document.querySelector('#section-list').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit-section]');
  if (edit) openSection(state.sections.find((item) => item.id === edit.dataset.editSection));
});

document.querySelector('#document-list').addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-edit-document]');
  if (edit) await openDocument(state.documents.find((item) => item.id === edit.dataset.editDocument));
  const remove = event.target.closest('[data-delete-document]');
  if (remove) {
    const item = state.documents.find((candidate) => candidate.id === remove.dataset.deleteDocument);
    const confirmed = await askConfirmation({ title: 'Hapus halaman?', message: `“${item.title}” akan dihapus dari dokumentasi. Backup dibuat secara otomatis.`, confirmLabel: 'Hapus halaman' });
    if (!confirmed) return;
    try { await api(`/api/admin/documents/${item.id}`, { method: 'DELETE' }); await refresh(); showToast('Halaman dihapus dan dicadangkan.'); } catch (error) { showToast(error.message, true); }
  }
});

projectForm.elements.title.addEventListener('input', () => { if (!projectForm.elements.id.value) projectForm.elements.slug.value = slugify(projectForm.elements.title.value); });
sectionForm.elements.title.addEventListener('input', () => { if (!sectionForm.elements.id.value) sectionForm.elements.slug.value = slugify(sectionForm.elements.title.value); });
documentForm.elements.title.addEventListener('input', () => { if (!documentForm.elements.id.value) documentForm.elements.slug.value = slugify(documentForm.elements.title.value); });
documentForm.elements.projectId.addEventListener('change', () => fillSectionOptions(documentForm.elements.projectId.value));
document.querySelector('#markdown-input').addEventListener('input', () => {
  updateMarkdownCount();
  updatePreview();
});

projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = formObject(projectForm);
  const id = values.id;
  delete values.id;
  try {
    await api(id ? `/api/admin/projects/${id}` : '/api/admin/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    projectDialog.close();
    await refresh();
    showToast(id ? 'Proyek diperbarui.' : 'Proyek dibuat.');
  } catch (error) { setFormError(projectForm, error.message); }
});

sectionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = formObject(sectionForm);
  const id = values.id;
  delete values.id;
  try {
    await api(id ? `/api/admin/sections/${id}` : '/api/admin/sections', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    sectionDialog.close();
    state.selectedProjectId = values.projectId;
    await refresh();
    showToast(id ? 'Bagian diperbarui.' : 'Bagian dibuat.');
  } catch (error) { setFormError(sectionForm, error.message); }
});

documentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = formObject(documentForm);
  const id = values.id;
  delete values.id;
  try {
    await api(id ? `/api/admin/documents/${id}` : '/api/admin/documents', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    documentDialog.close();
    await refresh();
    showToast(id ? 'Halaman diperbarui.' : 'Halaman dibuat.');
  } catch (error) { setFormError(documentForm, error.message); }
});

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!orderDraft?.dirty) return;
  const button = document.querySelector('#save-order');
  button.disabled = true;
  button.textContent = 'Menyimpan…';
  try {
    await api('/api/admin/order', {
      method: 'PUT',
      body: JSON.stringify({ projectIds: orderDraft.projectIds, structures: orderDraft.structures }),
    });
    orderDialog.close();
    await refresh();
    showToast('Urutan konten disimpan.');
  } catch (error) {
    document.querySelector('#order-status').textContent = error.message;
    button.disabled = false;
  } finally {
    button.textContent = 'Simpan urutan';
  }
});

document.querySelector('#delete-project').addEventListener('click', async () => {
  if (!projectForm.elements.id.value) return;
  const project = state.projects.find((item) => item.id === projectForm.elements.id.value);
  const sectionCount = state.sections.filter((item) => item.projectId === project.id).length;
  const documentCount = state.documents.filter((item) => item.projectId === project.id).length;
  const confirmed = await askConfirmation({ title: 'Hapus proyek?', message: `“${project.title}” beserta ${sectionCount} bagian dan ${documentCount} halaman di dalamnya akan dihapus. Backup dibuat secara otomatis.`, confirmLabel: 'Hapus proyek' });
  if (!confirmed) return;
  try {
    const result = await api(`/api/admin/projects/${project.id}`, { method: 'DELETE' });
    projectDialog.close();
    await refresh();
    showToast(`Proyek, ${result.removedSections} bagian, dan ${result.removedDocuments} halaman dihapus dan dicadangkan.`);
  } catch (error) { setFormError(projectForm, error.message); }
});

document.querySelector('#delete-section').addEventListener('click', async () => {
  if (!sectionForm.elements.id.value) return;
  const section = state.sections.find((item) => item.id === sectionForm.elements.id.value);
  const confirmed = await askConfirmation({ title: 'Hapus bagian?', message: `“${section.title}” akan dihapus. Bagian hanya dapat dihapus jika tidak berisi halaman.`, confirmLabel: 'Hapus bagian' });
  if (!confirmed) return;
  try { await api(`/api/admin/sections/${section.id}`, { method: 'DELETE' }); sectionDialog.close(); await refresh(); showToast('Bagian dihapus.'); } catch (error) { setFormError(sectionForm, error.message); }
});

try {
  const session = await api('/api/auth/session');
  state.csrfToken = session.csrfToken;
  await refresh();
  showDashboard();
} catch {
  showLogin();
}
