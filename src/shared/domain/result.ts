export type Result<T, E = Error> = Success<T, E> | Failure<T, E>;

export class Success<T, E> {
  readonly isSuccess = true as const;
  readonly isFailure = false as const;
  constructor(readonly value: T) {}
}

export class Failure<T, E> {
  readonly isSuccess = false as const;
  readonly isFailure = true as const;
  constructor(readonly error: E) {}
}

export const ok = <T, E = Error>(value: T): Result<T, E> => new Success(value);
export const fail = <T, E = Error>(error: E): Result<T, E> => new Failure(error);
