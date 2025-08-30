import { WebSocketServer } from 'ws';
import { GameManager } from './GameManager';
import url from 'url';
import { extractAuthUser } from './auth';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8001;
const wss = new WebSocketServer({ port: PORT });

const gameManager = new GameManager();

wss.on('connection', (ws, req) => {
  //@ts-ignore
  const token: string = url.parse(req.url, true).query.token;
  const user = extractAuthUser(token, ws);
  gameManager.addUser(user);
  ws.on('close', () => {
    gameManager.removeUser(ws);
  });
});
