import type {OnlineResumeKey} from "@glowplug-studio/figcraft-react";

export interface OwnerRecoveryLock {
  key: OnlineResumeKey;
  release(): void;
}

/** Native locks each process's recovery folder. A browser tab holds its editing client's lock until it leaves. */
export async function ownerRecoveryLock(principal: string, server: string, saved?: OnlineResumeKey): Promise<OwnerRecoveryLock | undefined> {
  const locks = globalThis.navigator?.locks;
  const key = saved ?? {handle: crypto.randomUUID(), secret: crypto.randomUUID()};
  if (locks) {
    const acquired = await new Promise<OwnerRecoveryLock | undefined>(resolve => {
      const name = JSON.stringify(["figcraft-online-recovery", principal, server, key.handle]);
      void locks.request(name, {ifAvailable: true}, lock => {
        if (!lock) {resolve(undefined); return;}
        return new Promise<void>(release => resolve({key, release}));
      }).catch(() => resolve(undefined));
    });
    if (acquired) return acquired;
  }
  if (saved) throw new Error("This editing client could not be reclaimed on this device");
}
