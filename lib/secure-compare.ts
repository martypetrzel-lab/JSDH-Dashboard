import { createHash, timingSafeEqual } from 'node:crypto';

export function constantTimeEqual(actual: string, expected: string) {
  const actualDigest = createHash('sha256').update(actual, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
