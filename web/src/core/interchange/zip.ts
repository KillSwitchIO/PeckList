// Zip archives as other apps' backups come (a Todoist backup, a Google Takeout), read with the
// browser's own inflater, and written (stored, not compressed) for an export of several files.
// Neither Zip64 nor encryption: none of these exports use them.

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const utf8 = new TextDecoder();

/** Whether `bytes` start like a zip archive. */
export const isZip = (bytes: Uint8Array) =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;

/** Bytes as a stream. */
export const streamOf = (data: Uint8Array<ArrayBuffer>) =>
  new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

/**
 * What an archive may hold (audit W4): its header sizes are the archive's own word, so a crafted
 * one could declare a gigabyte entry and take the tab down inflating it. Far above any real
 * export (a large Todoist backup is a few MB).
 */
export const ZIP_LIMITS = {
  entries: 10_000,
  entryBytes: 256 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
};

export type ZipLimits = typeof ZIP_LIMITS;

/** Inflate, stopping as soon as the output passes `cap` bytes, whatever the header said. */
async function inflate(data: Uint8Array, cap: number): Promise<Uint8Array> {
  const reader = streamOf(data.slice())
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > cap) {
      await reader.cancel();
      throw new Error('zip entry too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Every file in a zip archive (folders left out), within `limits`. */
export async function readZip(
  bytes: Uint8Array,
  limits: ZipLimits = ZIP_LIMITS,
): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => new Error('damaged zip archive');
  /** `length` bytes from `from` lie inside the archive. */
  const inside = (from: number, length: number) =>
    from >= 0 && length >= 0 && from + length <= bytes.length;
  // The end record sits in the last 64 KiB (after it, at most a comment).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive');
  const count = view.getUint16(end + 10, true);
  if (count > limits.entries) throw new Error('zip archive with too many files');
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (!inside(at, 46) || view.getUint32(at, true) !== 0x02014b50) throw damaged();
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (!inside(at + 46, nameLength)) throw damaged();
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (!inside(local, 30)) throw damaged();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (!inside(start, size)) throw damaged();
    const data = bytes.subarray(start, start + size);
    const left = limits.totalBytes - total;
    const cap = Math.min(limits.entryBytes, left);
    let entry: Uint8Array | null = null;
    if (method === 0) {
      if (size > cap) throw new Error('zip entry too large');
      entry = data;
    } else if (method === 8) {
      entry = await inflate(data, cap);
    }
    if (entry) {
      total += entry.length;
      entries.push({ name, bytes: entry });
    }
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Files as a zip archive, stored as they are. */
export function writeZip(files: readonly { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names in UTF-8
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((sum, each) => sum + each.length, 0);
  const tail = new Uint8Array(22);
  const tv = new DataView(tail.buffer);
  tv.setUint32(0, 0x06054b50, true);
  tv.setUint16(8, files.length, true);
  tv.setUint16(10, files.length, true);
  tv.setUint32(12, size, true);
  tv.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...parts, ...central, tail]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
