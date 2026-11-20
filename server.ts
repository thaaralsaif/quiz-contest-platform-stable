import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { TriviaEngine } from './server/engine.ts';
import process from 'node:process';

// ─── Security: Helmet CSP ──────────────────────────────────────────────
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  mediaSrc: ["'self'", 'https:'],
  connectSrc: ["'self'", 'ws:', 'wss:'],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

async function startServer(): Promise<void> {
  const PORT = Number(process.env.PORT) || 3000;
  const app = express();

  // ─── Security Middleware ─────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginEmbedderPolicy: false, // needed for WebSocket
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000 } : false,
  }));

  // ─── Rate Limiting ───────────────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 60_000, // 1 minute
    max: 120,         // 120 requests per minute per IP
    message: { status: 'RATE_LIMITED', message: '⚠️ عدد الطلبات كبير جداً، يرجى الانتظار' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000, // 15 minutes
    max: 10,               // 10 attempts per 15 min
    message: { status: 'RATE_LIMITED', message: '⚠️ محاولات تسجيل دخول كثيرة، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(['/api/host/answers', '/api/host/team-tokens', '/api/team/verify', '/api/team/traps'], authLimiter);

  app.use(express.json({ limit: '5mb' }));

  const engine = new TriviaEngine();

  // ─── Health & State ──────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, now: Date.now() });
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      state: engine.getSanitizedState(),
      questions: engine.getStrippedQuestions(),
    });
  });

  app.get('/api/questions', (_req, res) => {
    res.json({ questions: engine.getStrippedQuestions() });
  });

  // ─── Actions ─────────────────────────────────────────────────────────
  app.post('/api/action', (req, res) => {
    const body = (req.body || {}) as { action?: string; payload?: Record<string, unknown> };
    if (!body.action) {
      res.status(400).json({ status: 'BAD_REQUEST', message: 'Missing action name' });
      return;
    }
    const result = engine.handleAction(body.action, body.payload || {});
    res.json(result);
  });

  // ─── Host/Admin Endpoints (PIN required in production) ──────────────
  app.post('/api/host/answers', (req, res) => {
    const body = (req.body || {}) as { pin?: string };
    const result = engine.getHostAnswers(typeof body.pin === 'string' ? body.pin : '');
    if (result.status === 'INVALID_PIN') {
      res.status(401).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/host/team-tokens', (_req, res) => {
    res.json(engine.getHostTeamTokens());
  });

  // ─── Team Endpoints ──────────────────────────────────────────────────
  app.post('/api/team/verify', (req, res) => {
    const body = (req.body || {}) as { teamId?: string; token?: string };
    const result = engine.verifyTeamToken(
      typeof body.teamId === 'string' ? body.teamId : '',
      typeof body.token === 'string' ? body.token : ''
    );
    if (!result.valid) {
      res.status(403).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/team/traps', (req, res) => {
    const body = (req.body || {}) as { teamId?: string; token?: string };
    const result = engine.getTeamTraps(
      typeof body.teamId === 'string' ? body.teamId : '',
      typeof body.token === 'string' ? body.token : ''
    );
    if (result.status === 'INVALID_TOKEN') {
      res.status(403).json(result);
      return;
    }
    res.json(result);
  });

  // ─── Static / SPA ────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // ─── HTTP Server + WebSocket ────────────────────────────────────────
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Track connections per IP for WS rate limiting
  const wsConnectionsPerIp = new Map<string, number>();
  const MAX_WS_PER_IP = 10;

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (reqUrl.pathname === '/ws') {
        // Get client IP
        const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   request.socket.remoteAddress ||
                   'unknown';

        // Enforce per-IP WS connection limit
        const current = wsConnectionsPerIp.get(ip) || 0;
        if (current >= MAX_WS_PER_IP) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          wsConnectionsPerIp.set(ip, current + 1);
          (ws as WebSocket & { _clientIp?: string })._clientIp = ip;
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  engine.subscribe((safeState, safeQuestions) => {
    const payload = JSON.stringify({
      type: 'state:sync',
      state: safeState,
      questions: safeQuestions,
      serverNow: Date.now(), // include server timestamp for client clock sync
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // ─── WebSocket Heartbeat with Backpressure Handling ─────────────────
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const tracked = client as WebSocket & { isAlive?: boolean; _clientIp?: string };
      if (tracked.isAlive === false) {
        // Cleanup IP tracking
        if (tracked._clientIp) {
          const count = wsConnectionsPerIp.get(tracked._clientIp) || 1;
          wsConnectionsPerIp.set(tracked._clientIp, Math.max(0, count - 1));
        }
        tracked.terminate();
        continue;
      }
      // Backpressure check: don't ping if client's send buffer is full
      if (tracked.bufferedAmount > 16 * 1024) {
        if (tracked._clientIp) {
          const count = wsConnectionsPerIp.get(tracked._clientIp) || 1;
          wsConnectionsPerIp.set(tracked._clientIp, Math.max(0, count - 1));
        }
        tracked.terminate();
        continue;
      }
      tracked.isAlive = false;
      tracked.ping();
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws) => {
    const tracked = ws as WebSocket & { isAlive?: boolean; _clientIp?: string };
    tracked.isAlive = true;
    ws.on('pong', () => {
      tracked.isAlive = true;
    });

    ws.send(
      JSON.stringify({
        type: 'state:sync',
        state: engine.getSanitizedState(),
        questions: engine.getStrippedQuestions(),
        serverNow: Date.now(),
      })
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          requestId?: string;
          action?: string;
          payload?: Record<string, unknown>;
        };
        if (msg.type === 'action' && msg.action) {
          const result = engine.handleAction(msg.action, msg.payload || {});
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'action:ack',
                requestId: msg.requestId || null,
                result,
                serverNow: Date.now(),
              })
            );
          }
        } else if (msg.type === 'sync:request') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'state:sync',
                state: engine.getSanitizedState(),
                questions: engine.getStrippedQuestions(),
                serverNow: Date.now(),
              })
            );
          }
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      if (tracked._clientIp) {
        const count = wsConnectionsPerIp.get(tracked._clientIp) || 1;
        wsConnectionsPerIp.set(tracked._clientIp, Math.max(0, count - 1));
      }
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Trivia Multi-Screen Real-Time Server running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
    console.log(`Security: Helmet CSP + Rate Limiting + WS Connection Limits (${MAX_WS_PER_IP}/IP)`);
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    engine.shutdown();
    httpServer.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    // Force close after 5 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});