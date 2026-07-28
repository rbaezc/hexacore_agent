import { describe, it, expect } from 'vitest';
import { ok, fail } from '../../src/shared/domain/result.js';

describe('Result Domain Pattern', () => {
  it('should create success result correctly', () => {
    const res = ok('Success data');
    expect(res.isSuccess).toBe(true);
    expect(res.isFailure).toBe(false);
    if (res.isSuccess) {
      expect(res.value).toBe('Success data');
    }
  });

  it('should create failure result correctly', () => {
    const error = new Error('Something went wrong');
    const res = fail(error);
    expect(res.isSuccess).toBe(false);
    expect(res.isFailure).toBe(true);
    if (res.isFailure) {
      expect(res.error.message).toBe('Something went wrong');
    }
  });
});
