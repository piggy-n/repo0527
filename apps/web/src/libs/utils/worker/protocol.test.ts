import { describe, expect, it } from 'vitest';
import {
  abortReason,
  isClientMessage,
  isServerMessage,
  serializeError,
  toError,
  transfer,
  unwrapTransfer,
  WorkerTaskError
} from './protocol';

describe('protocol', () => {
  it('serializes an error to its name, message and stack', () => {
    const serialized = serializeError(new RangeError('out of range'));

    expect(serialized).toMatchObject({ name: 'RangeError', message: 'out of range' });
    expect(serialized.stack).toContain('out of range');
  });

  it('serializes a thrown value that is not an error', () => {
    expect(serializeError('boom')).toEqual({ name: 'Error', message: 'boom' });
  });

  it('rebuilds a worker error with its original name and stack', () => {
    const error = new WorkerTaskError({ name: 'RangeError', message: 'out of range', stack: 'RangeError: out of range' });

    expect(error).toBeInstanceOf(WorkerTaskError);
    expect(error).toMatchObject({ name: 'RangeError', message: 'out of range', workerStack: 'RangeError: out of range' });
  });

  it.each([
    [{ kind: 'request', id: 1, method: 'decode', payload: null }, true],
    [{ kind: 'cancel', id: 1 }, true],
    [{ kind: 'request', id: 1 }, false],
    [{ kind: 'cancel', id: '1' }, false],
    [{ kind: 'result', id: 1, method: 'decode', value: 1 }, false],
    [null, false]
  ])('recognizes client message %j: %s', (data, expected) => {
    expect(isClientMessage(data)).toBe(expected);
  });

  it.each([
    [{ kind: 'result', id: 1, method: 'decode', value: undefined }, true],
    [{ kind: 'failure', id: 1, error: { name: 'Error', message: 'boom' } }, true],
    [{ kind: 'result', id: 1, value: 1 }, false],
    [{ kind: 'failure', id: 1, error: 'boom' }, false],
    [{ kind: 'request', id: 1, method: 'decode', payload: null }, false],
    ['result', false]
  ])('recognizes server message %j: %s', (data, expected) => {
    expect(isServerMessage(data)).toBe(expected);
  });

  it('marks values to transfer and leaves plain values alone', () => {
    const buffer = new ArrayBuffer(8);

    expect(unwrapTransfer(transfer({ buffer }, [buffer]))).toEqual({ value: { buffer }, transferables: [buffer] });
    expect(unwrapTransfer({ buffer })).toEqual({ value: { buffer }, transferables: [] });
  });

  it('turns any rejection reason into an error', () => {
    const error = new TypeError('bad');

    expect(toError(error)).toBe(error);
    expect(toError('bad')).toEqual(new Error('bad'));
    expect(toError(new DOMException('cannot clone', 'DataCloneError'))).toMatchObject({ name: 'DataCloneError' });
  });

  it('uses the reason of an aborted signal, or an AbortError when the reason is not an error', () => {
    const timeout = new DOMException('too slow', 'TimeoutError');
    const custom = new AbortController();
    custom.abort('stop');

    expect(abortReason(AbortSignal.abort(timeout))).toBe(timeout);
    expect(abortReason(custom.signal)).toMatchObject({ name: 'AbortError' });
  });
});
