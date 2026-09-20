import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

test('renderer menghasilkan HTML dari Markdown', () => {
  assert.match(renderMarkdown('# Judul'), /<h1>Judul<\/h1>/);
});

test('renderer mempertahankan baris baru dari editor', () => {
  const html = renderMarkdown('Baris pertama\nBaris kedua\nBaris ketiga');
  assert.match(html, /Baris pertama<br \/>Baris kedua<br \/>Baris ketiga/);
});

test('renderer membuang script dan event handler', () => {
  const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">');
  assert.doesNotMatch(html, /script|onerror/i);
});

test('renderer mengizinkan media aman dan membatasi host iframe', () => {
  const html = renderMarkdown('![Diagram](/media/abc)\n\n<video src="/media/video" autoplay></video>\n\n<iframe src="https://www.youtube-nocookie.com/embed/abcdef" title="Demo"></iframe>\n\n<iframe src="https://evil.example/embed/abcdef"></iframe>');
  assert.match(html, /<img src="\/media\/abc"/);
  assert.match(html, /<video src="\/media\/video" controls preload="metadata" playsinline><\/video>/);
  assert.match(html, /youtube-nocookie\.com\/embed\/abcdef/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /autoplay/);
});
