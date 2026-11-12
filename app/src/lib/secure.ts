import * as SecureStore from 'expo-secure-store';

const INVITE = 'invite_code';
const DEVICE = 'device_id';

export const getInvite = () => SecureStore.getItemAsync(INVITE);
export const setInvite = (code: string) => SecureStore.setItemAsync(INVITE, code.trim());

/** Random per-install id for the per-device daily limit. Not linked to the person. */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE);
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(DEVICE, id);
  return id;
}
