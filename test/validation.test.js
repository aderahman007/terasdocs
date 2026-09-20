import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, validateProject, validateSection } from '../src/validation.js';

test('validasi proyek menerima data yang valid', () => {
  const result = validateProject({ title: 'SIMRS', slug: 'simrs', description: '', order: 1, published: true });
  assert.equal(result.slug, 'simrs');
  assert.equal(result.order, 1);
});

test('validasi proyek menolak slug tidak aman', () => {
  assert.throws(() => validateProject({ title: 'SIMRS', slug: '../simrs', order: 0 }), /Slug/);
});

test('validasi dokumen memerlukan konten', () => {
  assert.throws(() => validateDocument({ projectId: 'x', sectionId: 'y', title: 'Judul', slug: 'judul', content: '', order: 0 }), /Konten/);
});

test('validasi section menerima data yang valid', () => {
  assert.equal(validateSection({ projectId: 'x', title: 'Memulai', slug: 'memulai', order: 0 }).slug, 'memulai');
});
