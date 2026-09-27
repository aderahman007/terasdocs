const state = {
  projects: [],
  navigation: new Map(),
  activeNavigation: null,
  activeDocumentId: null,
  pageFilter: '',
  searchSequence: 0,
};

const main = document.querySelector('#main-content');
const sidebar = document.querySelector('#sidebar');
const projectNav = document.querySelector('#project-nav');
const mobilePageNavigation = document.querySelector('#mobile-page-navigation');
const pageSidebar = document.querySelector('#page-sidebar');
const pageSidebarContent = document.querySelector('#page-sidebar-content');
const summaryLink = document.querySelector('#summary-link');
const search = document.querySelector('#search');
const searchResults = document.querySelector('#search-results');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function api(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      const returnPath = `${location.pathname}${location.search}${location.hash}`;
      location.assign(`/admin/?return=${encodeURIComponent(returnPath)}`);
    }
    const error = new Error(body.error || 'Tidak dapat memuat data.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function routeFor(project, page) {
  return `#/docs/${encodeURIComponent(project.slug)}/${encodeURIComponent(page.slug)}`;
}

function projectRoute(project) {
  return `#/project/${encodeURIComponent(project.slug)}`;
}

function collapsedKey(projectId) {
  return `docs-collapsed-${projectId}`;
}

function collapsedSections(projectId) {
  try { return new Set(JSON.parse(localStorage.getItem(collapsedKey(projectId)) || '[]')); } catch { return new Set(); }
}

function renderProjects(activeProjectId = null) {
  projectNav.innerHTML = state.projects.map((project) => `<a href="${projectRoute(project)}" class="group flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm transition ${project.id === activeProjectId ? 'bg-slate-900 font-semibold text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white'}"><span class="min-w-0 flex items-center gap-2"><span class="truncate">${escapeHtml(project.title)}</span>${project.visibility === 'private' ? '<span class="shrink-0 text-[9px] font-semibold uppercase tracking-wider opacity-65">Privat</span>' : ''}</span><span class="shrink-0 text-xs ${project.id === activeProjectId ? 'text-slate-300 dark:text-slate-500' : 'text-slate-400'}">${project.documentCount}</span></a>`).join('') || '<p class="px-3 py-2 text-sm text-slate-500">Belum ada dokumentasi.</p>';
}

async function loadNavigation(projectSlug) {
  if (!state.navigation.has(projectSlug)) state.navigation.set(projectSlug, await api(`/api/public/projects/${encodeURIComponent(projectSlug)}/navigation`));
  state.activeNavigation = state.navigation.get(projectSlug);
  return state.activeNavigation;
}

function pageNavigationSectionsMarkup(navigation, activeDocumentId) {
  const query = state.pageFilter.toLocaleLowerCase('id');
  const collapsed = collapsedSections(navigation.project.id);
  const activePage = navigation.documents.find((item) => item.id === activeDocumentId);
  if (activePage) collapsed.delete(activePage.sectionId);

  return navigation.sections.map((section) => {
    const pages = navigation.documents.filter((page) => page.sectionId === section.id && (!query || `${page.title} ${page.excerpt}`.toLocaleLowerCase('id').includes(query)));
    if (query && !pages.length) return '';
    const isCollapsed = !query && collapsed.has(section.id);
    return `<section class="border-b border-slate-200 pb-3 last:border-b-0 dark:border-slate-800">
      <button type="button" data-section-toggle="${section.id}" aria-expanded="${!isCollapsed}" class="flex w-full items-center justify-between gap-3 py-2 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white">
        <span class="truncate">${escapeHtml(section.title)}</span><span class="transition-transform ${isCollapsed ? '-rotate-90' : ''}">⌄</span>
      </button>
      <div class="space-y-0.5 ${isCollapsed ? 'hidden' : ''}">${pages.map((page) => `<a data-document-link="${page.id}" href="${routeFor(navigation.project, page)}" class="block border-l-2 py-1.5 pl-3 text-sm transition ${page.id === activeDocumentId ? 'border-slate-950 font-semibold text-slate-950 dark:border-white dark:text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-950 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white'}">${escapeHtml(page.title)}</a>`).join('') || '<p class="py-2 text-xs text-slate-400">Belum ada halaman</p>'}</div>
    </section>`;
  }).join('') || '<p class="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">Tidak ada halaman yang cocok.</p>';
}

function pageNavigationMarkup(navigation, activeDocumentId, mobile = false) {
  const sections = pageNavigationSectionsMarkup(navigation, activeDocumentId);
  return `<div class="min-h-full"><div class="mb-5"><p class="text-[11px] font-bold uppercase tracking-widest text-slate-400">Halaman</p><a href="${projectRoute(navigation.project)}" class="mt-1 block truncate font-semibold text-slate-950 hover:text-indigo-600 dark:text-white">${escapeHtml(navigation.project.title)}</a></div>
    <div class="relative mb-5"><svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input data-page-filter="${mobile ? 'mobile' : 'desktop'}" type="search" aria-label="Filter halaman ${escapeHtml(navigation.project.title)}" value="${escapeHtml(state.pageFilter)}" placeholder="Filter halaman..." class="field py-2 pl-9"></div>
    <nav data-page-results class="space-y-3" aria-label="Halaman ${escapeHtml(navigation.project.title)}">${sections}</nav></div>`;
}

function renderPageNavigation(navigation, activeDocumentId = null) {
  pageSidebar.style.removeProperty('display');
  mobilePageNavigation.classList.remove('hidden');
  pageSidebarContent.innerHTML = pageNavigationMarkup(navigation, activeDocumentId);
  mobilePageNavigation.innerHTML = pageNavigationMarkup(navigation, activeDocumentId, true);
}

function hidePageNavigation() {
  pageSidebar.style.display = 'none';
  mobilePageNavigation.classList.add('hidden');
  pageSidebarContent.innerHTML = '';
  mobilePageNavigation.innerHTML = '';
}

function renderHome() {
  state.activeNavigation = null;
  state.activeDocumentId = null;
  state.pageFilter = '';
  renderProjects();
  summaryLink.classList.add('hidden');
  summaryLink.classList.remove('flex');
  hidePageNavigation();
  document.title = 'TerasDocs';
  main.innerHTML = `<div class="w-full"><header class="border-b border-slate-200 pb-6 dark:border-slate-800"><h1 class="max-w-3xl text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white">Dokumentasi produk dan layanan</h1><p class="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base dark:text-slate-400">Pilih dokumentasi yang ingin dibaca atau cari topik tertentu melalui kolom pencarian.</p></header><div class="divide-y divide-slate-200 dark:divide-slate-800">${state.projects.map((project, index) => `<a href="${projectRoute(project)}" class="group grid gap-3 py-6 transition sm:grid-cols-[2.5rem_1fr_auto] sm:items-start"><span class="font-mono text-xs text-slate-400">${String(index + 1).padStart(2, '0')}</span><span><span class="flex flex-wrap items-center gap-2"><strong class="text-lg font-semibold text-slate-950 group-hover:text-indigo-600 dark:text-white">${escapeHtml(project.title)}</strong>${project.visibility === 'private' ? '<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">Privat</span>' : ''}</span><span class="mt-1 block max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">${escapeHtml(project.description || 'Dokumentasi dan panduan.')}</span></span><span class="text-sm text-slate-400"><span>${project.documentCount} halaman</span><span class="ml-3 text-slate-900 dark:text-white">→</span></span></a>`).join('') || '<div class="border-b border-dashed border-slate-300 py-12 text-center text-slate-500">Belum ada dokumentasi yang dipublikasikan.</div>'}</div></div>`;
}

function renderProjectOverview(navigation) {
  state.activeDocumentId = null;
  state.pageFilter = '';
  renderProjects(navigation.project.id);
  summaryLink.classList.remove('hidden');
  summaryLink.classList.add('flex');
  renderPageNavigation(navigation);
  document.title = `${navigation.project.title} — TerasDocs`;
  main.innerHTML = `<div class="min-h-[calc(100vh-9rem)] w-full"><header class="border-b border-slate-200 pb-8 dark:border-slate-800"><div class="flex flex-wrap items-center gap-3"><h1 class="text-4xl font-bold tracking-tight text-slate-950 dark:text-white">${escapeHtml(navigation.project.title)}</h1>${navigation.project.visibility === 'private' ? '<span class="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">Dokumentasi privat</span>' : ''}</div><p class="mt-4 max-w-3xl text-base leading-7 text-slate-500 dark:text-slate-400">${escapeHtml(navigation.project.description)}</p></header><div class="divide-y divide-slate-200 dark:divide-slate-800">${navigation.sections.map((section, index) => { const pages = navigation.documents.filter((page) => page.sectionId === section.id); return `<section class="grid gap-3 py-6 sm:grid-cols-[2.5rem_1fr_auto] sm:items-center"><span class="font-mono text-xs text-slate-400">${String(index + 1).padStart(2, '0')}</span><span><h2 class="font-semibold text-slate-950 dark:text-white">${escapeHtml(section.title)}</h2><p class="mt-1 text-sm text-slate-500">${pages.length} halaman</p></span>${pages[0] ? `<a href="${routeFor(navigation.project, pages[0])}" class="text-sm font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">Mulai membaca →</a>` : '<span class="text-sm text-slate-400">Kosong</span>'}</section>`; }).join('')}</div></div>`;
}

function adjacentPageMarkup(navigation, target, direction) {
  if (!target) return '';
  const section = navigation.sections.find((item) => item.id === target.sectionId);
  const previous = direction === 'previous';
  const arrow = previous
    ? '<svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>'
    : '<svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 18 6-6-6-6"/></svg>';
  return `<a href="${routeFor(navigation.project, target)}" aria-label="${previous ? 'Halaman sebelumnya' : 'Halaman berikutnya'}: ${escapeHtml(target.title)}" class="group flex min-h-20 items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900 ${previous ? '' : 'text-right sm:col-start-2'}">
    ${previous ? `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-500 transition group-hover:-translate-x-0.5 group-hover:text-slate-950 dark:border-slate-700 dark:group-hover:text-white">${arrow}</span>` : ''}
    <span class="min-w-0 flex-1"><span class="block text-[11px] font-medium text-slate-500">${previous ? 'Sebelumnya' : 'Berikutnya'}</span><strong class="mt-0.5 block truncate text-sm font-semibold text-slate-950 dark:text-white">${escapeHtml(target.title)}</strong><span class="mt-0.5 block truncate text-[11px] text-slate-400">${escapeHtml(section?.title || navigation.project.title)}</span></span>
    ${previous ? '' : `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-slate-950 dark:border-slate-700 dark:group-hover:text-white">${arrow}</span>`}
  </a>`;
}

async function renderDocument(navigation, page) {
  state.activeDocumentId = page.id;
  renderProjects(navigation.project.id);
  summaryLink.classList.remove('hidden');
  summaryLink.classList.add('flex');
  renderPageNavigation(navigation, page.id);
  main.innerHTML = '<div class="min-h-[calc(100vh-9rem)] w-full animate-pulse py-2"><div class="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800"></div><div class="mt-6 h-10 w-2/3 rounded bg-slate-200 dark:bg-slate-800"></div></div>';
  try {
    const detail = await api(`/api/public/documents/${encodeURIComponent(page.id)}`);
    const index = navigation.documents.findIndex((item) => item.id === page.id);
    const previous = navigation.documents[index - 1];
    const next = navigation.documents[index + 1];
    const currentSection = navigation.sections.find((item) => item.id === page.sectionId);
    const previousMarkup = adjacentPageMarkup(navigation, previous, 'previous');
    const nextMarkup = adjacentPageMarkup(navigation, next, 'next');
    document.title = `${detail.title} — TerasDocs`;
    main.innerHTML = `<article class="min-h-[calc(100vh-9rem)] w-full"><div class="mb-10 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500"><a href="#/" class="hover:text-slate-950 dark:hover:text-white">Dokumentasi</a><span class="text-slate-300 dark:text-slate-700">/</span><a href="${projectRoute(navigation.project)}" class="hover:text-slate-950 dark:hover:text-white">${escapeHtml(navigation.project.title)}</a>${currentSection ? `<span class="text-slate-300 dark:text-slate-700">/</span><span class="text-slate-400">${escapeHtml(currentSection.title)}</span>` : ''}</div><div class="prose-docs">${detail.html}</div><footer class="mt-12 border-t border-slate-200 pt-6 dark:border-slate-800"><div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-slate-500"><span class="font-semibold text-slate-700 dark:text-slate-300">Lanjutkan membaca</span> · Halaman ${index + 1} dari ${navigation.documents.length}</p><a href="${projectRoute(navigation.project)}" class="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white">Lihat semua halaman</a></div><nav aria-label="Navigasi antarhalaman" class="mt-3 grid gap-3 sm:grid-cols-2">${previousMarkup}${nextMarkup}</nav></footer></article>`;
    requestAnimationFrame(() => document.querySelector(`[data-document-link="${page.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  } catch (error) { renderError(error.message); }
}

function renderError(message) {
  hidePageNavigation();
  main.innerHTML = `<div class="mx-auto max-w-xl border-y border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950/30"><h1 class="text-xl font-bold text-red-800 dark:text-red-300">Dokumentasi tidak dapat dimuat</h1><p class="mt-2 text-red-700 dark:text-red-400">${escapeHtml(message)}</p><a href="#/" class="button-primary mt-6">Kembali</a></div>`;
}

async function handleRoute() {
  closeMenu();
  window.scrollTo({ top: 0, behavior: 'auto' });
  try {
    const documentMatch = location.hash.match(/^#\/docs\/([^/]+)\/([^/]+)$/);
    const projectMatch = location.hash.match(/^#\/project\/([^/]+)$/);
    if (!documentMatch && !projectMatch) return renderHome();
    const projectSlug = decodeURIComponent((documentMatch || projectMatch)[1]);
    const navigation = await loadNavigation(projectSlug);
    if (projectMatch) return renderProjectOverview(navigation);
    const page = navigation.documents.find((item) => item.slug === decodeURIComponent(documentMatch[2]));
    if (!page) return renderError('Halaman yang Anda cari tidak ditemukan.');
    await renderDocument(navigation, page);
  } catch (error) { renderError(error.message); }
}

function closeMenu() {
  sidebar.classList.add('-translate-x-full');
  document.querySelector('#sidebar-overlay').classList.add('hidden');
}

function rerenderPageNavigation() {
  if (state.activeNavigation) renderPageNavigation(state.activeNavigation, state.activeDocumentId);
}

function refreshPageFilterResults(sourceInput) {
  if (!state.activeNavigation) return;
  const markup = pageNavigationSectionsMarkup(state.activeNavigation, state.activeDocumentId);
  document.querySelectorAll('[data-page-results]').forEach((container) => { container.innerHTML = markup; });
  document.querySelectorAll('[data-page-filter]').forEach((input) => {
    if (input !== sourceInput) input.value = state.pageFilter;
  });
}

function setupInteractions() {
  document.querySelector('#menu-button').addEventListener('click', () => { sidebar.classList.remove('-translate-x-full'); document.querySelector('#sidebar-overlay').classList.remove('hidden'); });
  document.querySelector('#close-menu').addEventListener('click', closeMenu);
  document.querySelector('#sidebar-overlay').addEventListener('click', closeMenu);
  document.querySelector('#theme-button').addEventListener('click', () => { const dark = document.documentElement.classList.toggle('dark'); localStorage.setItem('docs-theme', dark ? 'dark' : 'light'); });
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-section-toggle]');
    if (!toggle || !state.activeNavigation) return;
    const collapsed = collapsedSections(state.activeNavigation.project.id);
    const id = toggle.dataset.sectionToggle;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    localStorage.setItem(collapsedKey(state.activeNavigation.project.id), JSON.stringify([...collapsed]));
    rerenderPageNavigation();
  });
  document.addEventListener('input', (event) => {
    if (!event.target.matches('[data-page-filter]')) return;
    state.pageFilter = event.target.value;
    refreshPageFilterResults(event.target);
  });
  search.addEventListener('input', () => {
    const query = search.value.trim();
    const sequence = ++state.searchSequence;
    clearTimeout(search.timer);
    if (query.length < 2) return searchResults.classList.add('hidden');
    search.timer = setTimeout(async () => {
      try {
        const matches = await api(`/api/public/search?q=${encodeURIComponent(query)}`);
        if (sequence !== state.searchSequence) return;
        searchResults.innerHTML = matches.map((item) => `<a role="option" href="${routeFor(item.project, item)}" class="block rounded-md px-3 py-2 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800"><strong class="block text-sm">${escapeHtml(item.title)}</strong><span class="text-xs text-slate-500">${escapeHtml(item.project.title)}</span></a>`).join('') || '<p class="p-3 text-sm text-slate-500">Tidak ditemukan.</p>';
        searchResults.classList.remove('hidden');
      } catch { searchResults.classList.add('hidden'); }
    }, 250);
  });
  searchResults.addEventListener('click', () => { searchResults.classList.add('hidden'); search.value = ''; });
  document.addEventListener('click', (event) => { if (!event.target.closest('#search') && !event.target.closest('#search-results')) searchResults.classList.add('hidden'); });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape') {
      searchResults.classList.add('hidden');
      closeMenu();
    }
  });
  window.addEventListener('hashchange', handleRoute);
}

try {
  state.projects = await api('/api/public/projects');
  renderProjects();
  setupInteractions();
  await handleRoute();
} catch (error) { renderError(error.message); }
