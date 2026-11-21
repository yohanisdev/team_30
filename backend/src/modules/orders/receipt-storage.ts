import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import type { ImageType } from '../media/image-type.js';

/**
 * Receipts stay outside the public upload directory. `storageKey` is a relative name,
 * never a URL the browser can request.
 */
const directory = path.resolve(env.LOCAL_STORAGE_DIR, '..', 'private-receipts');

export async function savePrivateReceipt(buffer: Buffer, type: ImageType): Promise<string> {
  const storageKey = `${randomUUID()}.${type.ext}`;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, storageKey), buffer, { flag: 'wx' });
  return storageKey;
}
