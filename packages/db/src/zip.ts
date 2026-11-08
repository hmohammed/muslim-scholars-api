import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { open } from 'node:fs/promises';

// Store-only zip (no compression). The dataset CSVs are already the archive
// contents, and this keeps the build free of a zip dependency.

interface ZipEntry {
  name: string;
  crc: number;
  size: number;
  offset: number;
}

async function writeChunk(stream: WriteStream, chunk: Buffer): Promise<void> {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function checksum(path: string): Promise<{ crc: number; size: number }> {
  const file = await open(path, 'r');
  let crc = 0xffffffff;
  let size = 0;
  const buf = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const { bytesRead } = await file.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      for (let i = 0; i < bytesRead; i++) {
        crc ^= buf[i] ?? 0;
        for (let bit = 0; bit < 8; bit++) {
          const mask = -(crc & 1);
          crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
      }
    }
  } finally {
    await file.close();
  }
  return { crc: (crc ^ 0xffffffff) >>> 0, size };
}

export async function writeStoredZip(outPath: string, files: { name: string; path: string }[]): Promise<void> {
  const out = createWriteStream(outPath);
  const failed = new Promise<never>((_resolve, reject) => out.on('error', reject));
  const entries: ZipEntry[] = [];
  let offset = 0;

  const write = async (chunk: Buffer): Promise<void> => {
    offset += chunk.length;
    await Promise.race([writeChunk(out, chunk), failed]);
  };

  for (const file of files) {
    const { crc, size } = await checksum(file.path);
    if (size > 0xffffffff) throw new Error(`${file.name} is too large for a zip file`);
    const name = Buffer.from(file.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    entries.push({ name: file.name, crc, size, offset });
    await write(header);
    await write(name);
    const handle = await open(file.path, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buf, 0, buf.length, null);
        if (bytesRead === 0) break;
        await write(Buffer.from(buf.subarray(0, bytesRead)));
      }
    } finally {
      await handle.close();
    }
  }

  const directoryAt = offset;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    await write(header);
    await write(name);
  }
  const directorySize = offset - directoryAt;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryAt, 16);
  await write(end);
  await Promise.race([
    new Promise<void>((resolve, reject) => out.end(() => resolve()) && out.on('error', reject)),
    failed,
  ]);
}

/** Reads a store-only zip. Used to check the CSV archive in tests. */
export function readStoredZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameAt = offset + 30;
    const name = buffer.toString('utf8', nameAt, nameAt + nameLength);
    const dataAt = nameAt + nameLength + extraLength;
    if (method !== 0) throw new Error(`zip entry ${name} is compressed`);
    files.set(name, Buffer.from(buffer.subarray(dataAt, dataAt + size)));
    offset = dataAt + size;
  }
  return files;
}
