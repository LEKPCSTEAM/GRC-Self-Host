import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNELS,
  EVENTS,
  type Channel,
  type EventName,
  type GrcApi,
} from '../shared/ipc';

const allowedChannels = new Set<string>(CHANNELS);
const allowedEvents = new Set<string>(EVENTS);

const api: GrcApi = {
  invoke: (channel: Channel, ...args: unknown[]) => {
    if (!allowedChannels.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (event: EventName, listener: (payload: any) => void) => {
    if (!allowedEvents.has(event)) throw new Error(`Blocked event: ${event}`);
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      listener(payload);
    ipcRenderer.on(`event:${event}`, wrapped);
    return () => ipcRenderer.removeListener(`event:${event}`, wrapped);
  },
};

contextBridge.exposeInMainWorld('grc', api);
