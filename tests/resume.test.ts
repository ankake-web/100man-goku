import { describe, it, expect, beforeEach } from 'vitest';
import { saveResume, loadResume, clearResume } from '../src/net/resume';

// node 環境には localStorage が無いので Map ベースのスタブを用意する。
class LocalStorageStub {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

describe('resume persistence', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: LocalStorageStub }).localStorage = new LocalStorageStub();
  });

  it('round-trips code / you / token', () => {
    saveResume({ code: 'ABCD', you: 'player2', token: 'tok123' });
    expect(loadResume()).toEqual({ code: 'ABCD', you: 'player2', token: 'tok123' });
  });

  it('returns null when nothing is saved', () => {
    expect(loadResume()).toBeNull();
  });

  it('clears the saved info', () => {
    saveResume({ code: 'WXYZ', you: 'player1', token: 't' });
    clearResume();
    expect(loadResume()).toBeNull();
  });

  it('ignores corrupted / incomplete values', () => {
    (globalThis as unknown as { localStorage: LocalStorageStub }).localStorage.setItem('catan_lan_resume', '{not json');
    expect(loadResume()).toBeNull();
    (globalThis as unknown as { localStorage: LocalStorageStub }).localStorage.setItem('catan_lan_resume', JSON.stringify({ code: 'X' }));
    expect(loadResume()).toBeNull(); // you/token 欠落
  });

  it('does not throw when localStorage is unavailable', () => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(() => saveResume({ code: 'A', you: 'player1', token: 't' })).not.toThrow();
    expect(loadResume()).toBeNull();
    expect(() => clearResume()).not.toThrow();
  });
});
