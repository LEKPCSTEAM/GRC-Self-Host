import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type Channel, type GrcApi } from '../shared/ipc';

const allowed = new Set<string>(CHANNELS);

const api: GrcApi = {
  invoke: (channel: Channel, ...args: unknown[]) => {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
};

contextBridge.exposeInMainWorld('grc', api);
