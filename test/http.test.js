import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server tidak siap tepat waktu.')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('TerasDocs berjalan')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server berhenti dengan kode ${code}.`));
    });
  });
}

test('HTTP login dan CRUD dokumentasi end-to-end', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'terasdocs-http-'));
  let port;
  try {
    port = await availablePort();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error.code === 'EPERM') return context.skip('Lingkungan ini tidak mengizinkan socket loopback.');
    throw error;
  }
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STORAGE_DIR: directory,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password-integrasi-kuat',
      ADMIN_PASSWORD_HASH: '',
      COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitUntilReady(child);
    const origin = `http://127.0.0.1:${port}`;
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);

    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password-integrasi-kuat' }),
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': session.csrfToken };

    const createdProjectResponse = await fetch(`${origin}/api/admin/projects`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'API', slug: 'api', description: '', order: 1, published: true }),
    });
    assert.equal(createdProjectResponse.status, 201);
    const project = await createdProjectResponse.json();
    const catalogResponse = await fetch(`${origin}/api/admin/catalog`, { headers: { Cookie: cookie } });
    const catalog = await catalogResponse.json();
    const section = catalog.sections.find((item) => item.projectId === project.id);

    const createdDocumentResponse = await fetch(`${origin}/api/admin/documents`, {
      method: 'POST', headers, body: JSON.stringify({ projectId: project.id, sectionId: section.id, title: 'Token', slug: 'token', excerpt: '', content: '# Token\n\n<script>alert(1)</script>', order: 0, published: true }),
    });
    assert.equal(createdDocumentResponse.status, 201);
    const document = await createdDocumentResponse.json();

    const publicResponse = await fetch(`${origin}/api/public/documents/${document.id}`);
    const publicDocument = await publicResponse.json();
    assert.equal(publicResponse.status, 200);
    assert.match(publicDocument.html, /<h1>Token<\/h1>/);
    assert.doesNotMatch(publicDocument.html, /script/i);

    const deletedResponse = await fetch(`${origin}/api/admin/documents/${document.id}`, { method: 'DELETE', headers });
    assert.equal(deletedResponse.status, 200);
  } finally {
    child.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
});
