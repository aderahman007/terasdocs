import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const BLOCK_SIZE = 512;

function writeString(buffer, value, offset, length) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > length) throw new Error(`Path arsip terlalu panjang: ${value}`);
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, value, offset, length) {
  const encoded = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0');
  if (encoded.length >= length) throw new Error('Nilai metadata arsip terlalu besar.');
  buffer.write(encoded, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function splitTarPath(filePath) {
  if (Buffer.byteLength(filePath) <= 100) return { name: filePath, prefix: '' };
  const separators = [...filePath.matchAll(/\//g)].map((match) => match.index).reverse();
  for (const index of separators) {
    const prefix = filePath.slice(0, index);
    const name = filePath.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`Path arsip terlalu panjang: ${filePath}`);
}

function tarHeader(name, stats) {
  const header = Buffer.alloc(BLOCK_SIZE);
  const parts = splitTarPath(name);
  writeString(header, parts.name, 0, 100);
  writeOctal(header, stats.mode & 0o777, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, stats.size, 124, 12);
  writeOctal(header, stats.mtimeMs / 1000, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeString(header, 'ustar\0', 257, 6);
  writeString(header, '00', 263, 2);
  writeString(header, 'terasdocs', 265, 32);
  writeString(header, 'terasdocs', 297, 32);
  if (parts.prefix) writeString(header, parts.prefix, 345, 155);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

async function* filesIn(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error('Backup tidak boleh berisi symbolic link.');
    if (stats.isDirectory()) yield* filesIn(absolute, child);
    else if (stats.isFile()) yield { absolute, relative: child, stats };
  }
}

async function* tarContents(directory) {
  for await (const file of filesIn(directory)) {
    const archivePath = `terasdocs-backup/${file.relative}`;
    yield tarHeader(archivePath, file.stats);
    for await (const chunk of createReadStream(file.absolute)) yield chunk;
    const padding = (BLOCK_SIZE - (file.stats.size % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding) yield Buffer.alloc(padding);
  }
  yield Buffer.alloc(BLOCK_SIZE * 2);
}

export async function streamTarGzip(directory, destination) {
  await pipeline(Readable.from(tarContents(directory)), createGzip({ level: 6 }), destination);
}

function tarString(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/, '');
}

function tarNumber(buffer, offset, length) {
  const value = tarString(buffer, offset, length).trim();
  const parsed = Number.parseInt(value || '0', 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Ukuran file dalam arsip tidak valid.');
  return parsed;
}

function parseTarHeader(header) {
  const expectedChecksum = tarNumber(header, 148, 8);
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const checksum = checksumHeader.reduce((total, byte) => total + byte, 0);
  if (checksum !== expectedChecksum) throw new Error('Checksum arsip tidak valid.');
  const name = tarString(header, 0, 100);
  const prefix = tarString(header, 345, 155);
  return { name: prefix ? `${prefix}/${name}` : name, size: tarNumber(header, 124, 12), type: String.fromCharCode(header[156] || 0) };
}

function safeArchivePath(name) {
  const root = 'terasdocs-backup/';
  if (!name.startsWith(root)) throw new Error('Struktur arsip bukan backup TerasDocs.');
  const relative = path.posix.normalize(name.slice(root.length));
  if (!relative || relative === '.' || relative.startsWith('../') || path.posix.isAbsolute(relative)) throw new Error('Path dalam arsip tidak aman.');
  const allowed = [
    /^backup-manifest\.json$/,
    /^(?:projects|sections|documents|media)\.json$/,
    /^\.initialized$/,
    /^(?:content|uploads)\/\.gitkeep$/,
    /^content\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.md$/,
    /^uploads\/[a-f0-9-]{36}\.[a-z0-9]+$/,
  ];
  if (!allowed.some((pattern) => pattern.test(relative))) throw new Error(`File tidak dikenal dalam backup: ${relative}`);
  return relative;
}

export async function saveStream(readable, target, maxBytes) {
  const handle = await open(target, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of readable) {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error(`Ukuran backup melebihi batas ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
        error.status = 413;
        throw error;
      }
      await handle.write(chunk);
    }
    return size;
  } catch (error) {
    await handle.close();
    await rm(target, { force: true });
    throw error;
  } finally {
    if ((await handle.stat().catch(() => null))) await handle.close();
  }
}

export async function extractTarGzip(source, destination, maxBytes) {
  await mkdir(destination, { recursive: true });
  const input = createReadStream(source).pipe(createGunzip());
  let pending = Buffer.alloc(0);
  let current = null;
  let padding = 0;
  let totalSize = 0;
  let foundEnd = false;
  const seen = new Set();

  try {
    for await (const chunk of input) {
      if (foundEnd) continue;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length) {
        if (current) {
          if (current.remaining > 0) {
            const length = Math.min(current.remaining, pending.length);
            await current.handle.write(pending.subarray(0, length));
            pending = pending.subarray(length);
            current.remaining -= length;
            if (current.remaining > 0) break;
          }
          await current.handle.close();
          padding = (BLOCK_SIZE - (current.size % BLOCK_SIZE)) % BLOCK_SIZE;
          current = null;
        }
        if (padding) {
          const length = Math.min(padding, pending.length);
          pending = pending.subarray(length);
          padding -= length;
          if (padding) break;
          continue;
        }
        if (pending.length < BLOCK_SIZE) break;
        const header = pending.subarray(0, BLOCK_SIZE);
        pending = pending.subarray(BLOCK_SIZE);
        if (header.every((byte) => byte === 0)) {
          foundEnd = true;
          break;
        }
        const entry = parseTarHeader(header);
        if (entry.type !== '0' && entry.type !== '\0') throw new Error('Backup hanya boleh berisi file biasa.');
        const relative = safeArchivePath(entry.name);
        if (seen.has(relative)) throw new Error(`File duplikat dalam backup: ${relative}`);
        seen.add(relative);
        totalSize += entry.size;
        if (totalSize > maxBytes) throw new Error(`Isi backup melebihi batas ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
        const target = path.resolve(destination, relative);
        if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error('Path dalam arsip tidak aman.');
        await mkdir(path.dirname(target), { recursive: true });
        const handle = await open(target, 'wx', 0o600);
        current = { handle, size: entry.size, remaining: entry.size };
      }
    }
    if (current && current.remaining === 0) {
      await current.handle.close();
      current = null;
    }
    if (current?.remaining || padding || !foundEnd) throw new Error('Arsip backup tidak lengkap atau rusak.');
    return { files: seen.size, size: totalSize };
  } catch (error) {
    await current?.handle?.close().catch(() => undefined);
    throw error;
  }
}
