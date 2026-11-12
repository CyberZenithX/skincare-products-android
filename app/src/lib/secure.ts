import * as SecureStore from 'expo-secure-store';

const INVITE = 'invite_code';
const DEVICE = 'device_id';

export const getInvite = () => SecureStore.getItemAsync(INVITE);
export const setInvite = (code: string) => SecureStore.setItemAsync(INVITE, code.trim());

/** Random per-install id for the per-device daily limit. Not linked to the person. */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE);
  if (existing) return existing;
  // Only used for the per-device daily limit, so Math.random is enough (Hermes has no WebCrypto by default).
  const id = `${Date.now().toString(36)}-${Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('')}`;
  await SecureStore.setItemAsync(DEVICE, id);
  return id;
}
