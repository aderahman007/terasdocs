import { assert } from './errors.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function cleanString(value, field, { required = true, max = 160 } = {}) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required) assert(result.length > 0, 422, `${field} wajib diisi.`);
  assert(result.length <= max, 422, `${field} maksimal ${max} karakter.`);
  return result;
}

export function cleanSlug(value, field = 'Slug') {
  const slug = cleanString(value, field, { max: 80 }).toLowerCase();
  assert(SLUG_PATTERN.test(slug), 422, `${field} hanya boleh berisi huruf kecil, angka, dan tanda hubung.`);
  return slug;
}

export function cleanBoolean(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

export function cleanOrder(value) {
  const order = Number(value);
  assert(Number.isInteger(order) && order >= 0 && order <= 9999, 422, 'Urutan harus berupa angka 0 sampai 9999.');
  return order;
}

export function cleanProjectVisibility(value, published = true) {
  const fallback = published === false ? 'draft' : 'public';
  const visibility = typeof value === 'string' ? value : fallback;
  assert(['public', 'private', 'draft'].includes(visibility), 422, 'Akses proyek harus publik, privat, atau draft.');
  return visibility;
}

export function validateProject(input) {
  const visibility = cleanProjectVisibility(input.visibility, input.published);
  return {
    title: cleanString(input.title, 'Judul'),
    slug: cleanSlug(input.slug),
    description: cleanString(input.description, 'Deskripsi', { required: false, max: 500 }),
    order: cleanOrder(input.order ?? 0),
    visibility,
    published: visibility !== 'draft',
  };
}

export function validateSection(input) {
  return {
    projectId: cleanString(input.projectId, 'Proyek', { max: 80 }),
    title: cleanString(input.title, 'Nama bagian'),
    slug: cleanSlug(input.slug, 'Slug bagian'),
    order: cleanOrder(input.order ?? 0),
  };
}

export function validateDocument(input) {
  return {
    projectId: cleanString(input.projectId, 'Proyek', { max: 80 }),
    sectionId: cleanString(input.sectionId, 'Bagian', { max: 80 }),
    title: cleanString(input.title, 'Judul'),
    slug: cleanSlug(input.slug),
    excerpt: cleanString(input.excerpt, 'Ringkasan', { required: false, max: 500 }),
    content: cleanString(input.content, 'Konten', { max: 1_000_000 }),
    order: cleanOrder(input.order ?? 0),
    published: cleanBoolean(input.published),
  };
}
