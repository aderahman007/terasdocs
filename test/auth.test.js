import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

const salt = '0123456789abcdef0123456789abcdef';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = `scrypt:${salt}:${scryptSync('password-yang-kuat', salt, 64).toString('hex')}`;
const auth = await import('../src/auth.js');

function request(body = {}, overrides = {}) {
  const req = { body, headers: {}, ip: '127.0.0.1', socket: {}, secure: false, ...overrides };
  req.get = (name) => req.headers?.[name.toLowerCase()];
  return req;
}

test('login membuat session dan CSRF token', async () => {
  const req = request({ username: 'admin', password: 'password-yang-kuat' });
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; } };
  const session = await auth.login(req, res);
  assert.ok(session.csrfToken);
  assert.match(headers['Set-Cookie'], /HttpOnly/);
  assert.match(headers['Set-Cookie'], /SameSite=Strict/);

  const cookieValue = headers['Set-Cookie'].split(';')[0];
  const authenticated = auth.getSession({ headers: { cookie: cookieValue } });
  assert.equal(authenticated.username, 'admin');
});

test('login menolak password salah', async () => {
  await assert.rejects(() => auth.login(request({ username: 'admin', password: 'salah' }), { setHeader() {} }), /salah/);
});

test('logout menghapus session dan cookie', async () => {
  const headers = {};
  await auth.login(request({ username: 'admin', password: 'password-yang-kuat' }, { ip: '127.0.0.2' }), { setHeader: (name, value) => { headers[name] = value; } });
  const cookieValue = headers['Set-Cookie'].split(';')[0];
  const logoutHeaders = {};
  auth.logout(request({}, { headers: { cookie: cookieValue } }), { setHeader: (name, value) => { logoutHeaders[name] = value; } });
  assert.equal(auth.getSession({ headers: { cookie: cookieValue } }), null);
  assert.match(logoutHeaders['Set-Cookie'], /Max-Age=0/);
});

test('CSRF menerima token session dan menolak token lain', () => {
  let accepted = false;
  const session = { csrfToken: 'token-yang-valid' };
  auth.requireCsrf(request({}, { headers: { 'x-csrf-token': session.csrfToken }, session }), {}, (error) => {
    assert.equal(error, undefined);
    accepted = true;
  });
  assert.equal(accepted, true);
  auth.requireCsrf(request({}, { headers: { 'x-csrf-token': 'token-salah' }, session }), {}, (error) => assert.equal(error.status, 403));
});
