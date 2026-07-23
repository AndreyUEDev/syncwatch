import type { IceServersConfig } from '../../shared/src/protocol';
import type { Env } from './index';

const CRED_TTL_S = 4 * 3600;

const FALLBACK: IceServersConfig = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
};

let cached: { config: IceServersConfig; expiresAt: number } | null = null;

/**
 * Эфемерные креды Cloudflare Realtime TURN. Без секретов (локальный dev)
 * отдаём только STUN — на одной машине хватает host-кандидатов.
 */
export async function getIceServers(env: Env): Promise<IceServersConfig> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return FALLBACK;
  if (cached && cached.expiresAt > Date.now() + 30 * 60_000) return cached.config;

  const resp = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: CRED_TTL_S }),
    },
  );
  if (!resp.ok) {
    console.error('turn credentials failed', resp.status, await resp.text());
    return FALLBACK;
  }

  const config = (await resp.json()) as IceServersConfig;
  cached = { config, expiresAt: Date.now() + CRED_TTL_S * 1000 };
  return config;
}
