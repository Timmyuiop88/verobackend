import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { SecretCryptoService } from './secret-crypto.service';

function serviceWithKey(hexKey: string): SecretCryptoService {
  return new SecretCryptoService({
    get: () => hexKey,
  } as unknown as ConfigService<never, true>);
}

describe('SecretCryptoService', () => {
  const key = randomBytes(32).toString('hex');

  it('round-trips a card number', () => {
    const service = serviceWithKey(key);
    const plaintext = '1234-5678-9012-3456';

    expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
  });

  it('round-trips a JSON array of cards', () => {
    const service = serviceWithKey(key);
    const cards = [
      { cardNumber: '1111', pinCode: '9999', redemptionUrl: null },
      { cardNumber: null, pinCode: null, redemptionUrl: 'https://x/?code=abc' },
    ];

    expect(service.decryptJson(service.encryptJson(cards))).toEqual(cards);
  });

  it('produces a different ciphertext each time for the same input', () => {
    const service = serviceWithKey(key);

    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const service = serviceWithKey(key);
    const [version, iv, tag, data] = service.encrypt('secret').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;

    expect(() =>
      service.decrypt(
        [version, iv, tag, flipped.toString('base64url')].join('.'),
      ),
    ).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    const encrypted = serviceWithKey(key).encrypt('secret');
    const other = serviceWithKey(randomBytes(32).toString('hex'));

    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('refuses to operate when no key is configured', () => {
    const service = serviceWithKey('');

    expect(service.isConfigured).toBe(false);
    expect(() => service.encrypt('secret')).toThrow(
      InternalServerErrorException,
    );
  });
});
