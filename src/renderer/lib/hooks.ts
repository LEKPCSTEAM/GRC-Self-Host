import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, Connection, Preset, Snapshot } from '../../shared/types';
import { api, call } from './api';

const EMPTY: Snapshot = { runners: [], foreign: [], quitPending: false };

export function useSnapshot(): Snapshot {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  useEffect(() => {
    const off = api.on('snapshot', setSnap);
    api.invoke('runners:snapshot').then(setSnap);
    return off;
  }, []);
  return snap;
}

/** Loads a list once and exposes a reload function. */
function useList<T>(load: () => Promise<T[] | undefined>): [T[], () => void] {
  const [items, setItems] = useState<T[]>([]);
  const reload = useCallback(() => {
    load().then((x) => x && setItems(x));
  }, [load]);
  useEffect(reload, [reload]);
  return [items, reload];
}

const loadConnections = () => call('connections:list');
const loadPresets = () => call('presets:list');

export const useConnections = (): [Connection[], () => void] =>
  useList(loadConnections);
export const usePresets = (): [Preset[], () => void] => useList(loadPresets);

let infoCache: AppInfo | undefined;

export function useAppInfo(): AppInfo | undefined {
  const [info, setInfo] = useState(infoCache);
  useEffect(() => {
    if (!infoCache) {
      api.invoke('app:info').then((i) => {
        infoCache = i;
        setInfo(i);
      });
    }
  }, []);
  return info;
}
