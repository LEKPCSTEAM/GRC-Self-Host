import type { GrcApi } from '../../shared/ipc';

declare global {
  interface Window {
    grc: GrcApi;
  }
}

export const api = window.grc;
