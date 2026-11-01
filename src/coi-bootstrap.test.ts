// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapIsolation } from './coi-bootstrap';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function mockWorker(register: ReturnType<typeof vi.fn>) {
  const worker = { controller: null, register, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('crossOriginIsolated', false);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { serviceWorker: worker });
  return worker;
}
describe('isolation startup diagnostics', () => {
  it('accepts an already isolated document without registering another worker', async () => {
    const worker = mockWorker(vi.fn());
    vi.stubGlobal('crossOriginIsolated', true);
    expect(await bootstrapIsolation()).toBe('Document isolation verified.');
    expect(worker.register).not.toHaveBeenCalled();
  });
  it('reports unavailable secure-context support without attempting registration', async () => {
    const worker = mockWorker(vi.fn());
    vi.stubGlobal('isSecureContext', false);
    expect(await bootstrapIsolation()).toContain('secure context and service-worker support required');
    expect(worker.register).not.toHaveBeenCalled();
  });
  it('preserves the specific browser registration error for fallback diagnostics', async () => {
    const worker = mockWorker(vi.fn().mockRejectedValue(new DOMException('Service workers blocked by browser policy', 'SecurityError')));
    const message = await bootstrapIsolation();
    expect(message).toContain('Service workers blocked by browser policy');
    expect(message).toContain('Testing single-thread fallback');
    expect(worker.removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  });
  it.each([
    new Error('Registration failed at https://example.test/?key=private authorization: fixture-key'),
    new DOMException('Registration failed at https://example.test/?key=private authorization: fixture-key', 'SecurityError'),
  ])('redacts URLs and credentials from registration errors: %s', async error => {
    mockWorker(vi.fn().mockRejectedValue(error));
    const message = await bootstrapIsolation();
    expect(message).toContain('Registration failed');
    expect(message).not.toContain('private');
    expect(message).not.toContain('fixture-key');
  });
  it('distinguishes registration timeout and cleans up timers and listeners', async () => {
    vi.useFakeTimers();
    const worker = mockWorker(vi.fn().mockImplementation(() => new Promise(() => {})));
    const pending = bootstrapIsolation(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toContain('Worker registration timed out.');
    expect(worker.removeEventListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes worker-control timeout after successful registration', async () => {
    vi.useFakeTimers();
    const worker = mockWorker(vi.fn().mockResolvedValue({ waiting: null }));
    const pending = bootstrapIsolation(100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toContain('Worker control timed out.');
    expect(worker.removeEventListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
