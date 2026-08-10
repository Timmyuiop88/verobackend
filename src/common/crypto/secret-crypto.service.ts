import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { Env } from '../../config/env.schema';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * Authenticated symmetric encryption for secrets that must be readable again
 * (gift card numbers and PINs) rather than merely verified — so hashing isn't
 * an option the way it is for passwords.
 *
 * Ciphertext format: `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The
 * version prefix exists so a future key rotation can decrypt old values with
 * the previous key while writing new ones under a new scheme.
 */
@Injectable()
export class SecretCryptoService {
  private readonly key: Buffer | null;

  constructor(config: ConfigService<Env, true>) {
    const hexKey = config.get('GIFTCARD_ENCRYPTION_KEY', { infer: true });
    this.key = hexKey ? Buffer.from(hexKey, 'hex') : null;
  }

  get isConfigured(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new InternalServerErrorException(
        'GIFTCARD_ENCRYPTION_KEY is not set — refusing to handle gift card codes',
      );
    }
    return this.key;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const key = this.requireKey();
    const [version, ivPart, tagPart, dataPart] = payload.split('.');
    if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
      throw new InternalServerErrorException(
        'Stored secret is malformed or was written under a different scheme',
      );
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}
