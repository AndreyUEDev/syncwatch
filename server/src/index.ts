import { Room } from './room';
import { generateRoomCode } from '../../shared/src/syncmath';

export { Room };

export interface Env {
  ROOMS: DurableObjectNamespace;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok');
    }

    const match = url.pathname.match(/^\/ws\/(new|[A-Z0-9]{4,8})$/);
    if (!match) {
      return new Response('not found', { status: 404 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('websocket expected', { status: 426 });
    }

    let code = match[1];
    if (code === 'new') {
      // Коллизия кода = живая комната с тем же кодом; пробуем несколько раз.
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateRoomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const probe = await stub.fetch('https://room/probe');
        if (probe.status === 404) break;
        if (attempt === 4) return new Response('no free codes', { status: 503 });
      }
    }

    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(new Request(`https://room/ws?code=${code}&create=${match[1] === 'new' ? 1 : 0}`, request));
  },
};
