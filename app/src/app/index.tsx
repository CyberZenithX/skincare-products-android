import { useEffect, useState } from 'react';
import { Redirect, type Href } from 'expo-router';
import { getInvite } from '@/lib/secure';
import { restoreDraft } from '@/lib/scanStore';

/** Entry: invite code first, then a mid-scan draft (after a language switch), else Welcome. */
export default function Index() {
  const [target, setTarget] = useState<Href | null>(null);
  useEffect(() => {
    (async () => {
      const code = await getInvite().catch(() => null);
      if (!code) return setTarget('/invite');
      const draft = await restoreDraft();
      setTarget((draft?.route as Href) ?? '/welcome');
    })();
  }, []);
  return target ? <Redirect href={target} /> : null;
}
