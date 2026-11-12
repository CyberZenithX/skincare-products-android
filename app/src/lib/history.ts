// Past scans, on this phone only. Saved: Skin Map geometry, the analysis and the
// picked listings. The photo is saved only if the user turned that setting on.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';
import type { AnalyzeResponse, SkinMapGeometry } from '@skinfix/shared';
import type { ListingState } from './scanStore';

const KEY = 'history:v1';
const SAVE_PHOTOS_KEY = 'settings:savePhotos';
const MAX = 30;

export interface HistoryEntry {
  id: string;
  date: string;
  geometry: SkinMapGeometry;
  result: AnalyzeResponse;
  listings: ListingState[];
  photoFile: string | null;
}

export async function getSavePhotos(): Promise<boolean> {
  return (await AsyncStorage.getItem(SAVE_PHOTOS_KEY)) === '1';
}
export async function setSavePhotos(on: boolean) {
  await AsyncStorage.setItem(SAVE_PHOTOS_KEY, on ? '1' : '0');
}

export async function listHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function photosDir() {
  const d = new Directory(Paths.document, 'scan-photos');
  if (!d.exists) d.create();
  return d;
}

export async function saveScan(
  entry: Omit<HistoryEntry, 'id' | 'date' | 'photoFile'>,
  photoBase64: string | null,
): Promise<HistoryEntry> {
  const id = `${Date.now()}`;
  let photoFile: string | null = null;
  if (photoBase64 && (await getSavePhotos())) {
    const f = new File(photosDir(), `${id}.jpg`);
    f.write(photoBase64, { encoding: 'base64' });
    photoFile = f.uri;
  }
  const full: HistoryEntry = { ...entry, id, date: new Date().toISOString(), photoFile };
  const all = [full, ...(await listHistory())];
  for (const old of all.slice(MAX)) removePhoto(old.photoFile);
  await AsyncStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
  return full;
}

/** Listings arrive after the scan is saved; attach them when they do. */
export async function updateListings(id: string, listings: ListingState[]) {
  const all = await listHistory();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return;
  all[i] = { ...all[i]!, listings };
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

function removePhoto(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* gone */
  }
}

export async function clearHistory() {
  for (const e of await listHistory()) removePhoto(e.photoFile);
  try {
    const d = new Directory(Paths.document, 'scan-photos');
    if (d.exists) d.delete();
  } catch {
    /* gone */
  }
  await AsyncStorage.removeItem(KEY);
}

export function readPhotoBase64(uri: string | null): string | null {
  if (!uri) return null;
  try {
    const f = new File(uri);
    return f.exists ? f.base64Sync() : null;
  } catch {
    return null;
  }
}
