import { WebSocket } from 'ws';
import {
  GAME_OVER,
  INIT_GAME,
  JOIN_GAME,
  OPPONENT_DISCONNECTED,
  JOIN_ROOM,
  GAME_JOINED,
  GAME_NOT_FOUND,
  GAME_ALERT,
  GAME_ADDED,
  GAME_ENDED,
  EXIT_GAME,
} from './messages';
import { Game } from './Game';
import { db } from './db';
import { socketManager, User } from './SocketManager';
import { GameStatus } from './generated/prisma';
import { USER_RATING_MATCH_THRESHOLD } from './constants';

export class GameManager {
  private games: Game[];
  private matchMakingQueue: User[];
  private users: User[];

  constructor() {
    this.games = [];
    this.matchMakingQueue = [];
    this.users = [];
  }

  addUser(user: User) {
    this.users.push(user);
    this.addHandler(user);
  }

  removeUser(socket: WebSocket) {
    const user = this.users.find((user) => user.socket === socket);
    if (!user) {
      console.error('User not found?');
      return;
    }
    this.users = this.users.filter((user) => user.socket !== socket);
    socketManager.removeUser(user);
  }

  removeGame(gameId: string) {
    this.games = this.games.filter((g) => g.gameId !== gameId);
  }

  private addHandler(user: User) {
    user.socket.on('message', async (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === INIT_GAME) {
        // Making a match between users of closer rating 
        const opponents = this.matchMakingQueue.filter((u) => (Math.abs(user.rating - u.rating) < USER_RATING_MATCH_THRESHOLD && u.userId !== user.userId));
        opponents.sort((a, b) => Math.abs(user.rating - a.rating) - Math.abs(user.rating - b.rating));
        if (opponents.length > 0) {
          const opponent = opponents.shift()!;
          const game = new Game(user.userId, opponent.userId);
          this.games.push(game);
          socketManager.addUser(user, game.gameId);
          await game?.updateSecondPlayer(user.userId);
          this.matchMakingQueue = this.matchMakingQueue.filter((u) => u.userId !== opponent.userId);
        } else {
          const game = new Game(user.userId, null);
          this.games.push(game);
          this.matchMakingQueue.push(user);
          socketManager.addUser(user, game.gameId);
          socketManager.broadcast(
            game.gameId,
            JSON.stringify({
              type: GAME_ADDED,
              gameId:game.gameId,
            }),
          );
        }
      }

      if (message.type === EXIT_GAME){
        const gameId = message.payload.gameId;
        const game = this.games.find((game) => game.gameId === gameId);
        
        if (game) {
          this.matchMakingQueue = this.matchMakingQueue.filter((u) => u.userId !== game.player1UserId && u.userId !== game.player2UserId);
          game.exitGame(user);
          this.removeGame(game.gameId)
        }
      }

      if (message.type === JOIN_ROOM) {
        const gameId = message.payload?.gameId;
        if (!gameId) {
          return;
        }

        let availableGame = this.games.find((game) => game.gameId === gameId);
        const gameFromDb = await db.game.findUnique({
          where: { id: gameId },
          include: {
            blackPlayer: true,
            whitePlayer: true,
          },
        });

        // There is a game created but no second player available
        
        if (availableGame && !availableGame.player2UserId) {
          this.matchMakingQueue = this.matchMakingQueue.filter((u) => u.userId !== availableGame?.player1UserId);
          socketManager.addUser(user, availableGame.gameId);
          await availableGame.updateSecondPlayer(user.userId);
          return;
        }

        if (!gameFromDb) {
          user.socket.send(
            JSON.stringify({
              type: GAME_NOT_FOUND,
            }),
          );
          return;
        }

        if(gameFromDb.status !== GameStatus.IN_PROGRESS) {
          user.socket.send(JSON.stringify({
            type: GAME_ENDED,
            payload: {
              result: gameFromDb.result,
              status: gameFromDb.status,
              blackPlayer: {
                id: gameFromDb.blackPlayer?.id,
                name: gameFromDb.blackPlayer?.username,
              },
              whitePlayer: {
                id: gameFromDb.whitePlayer?.id,
                name: gameFromDb.whitePlayer?.username,
              },
            }
          }));
          return;
        }

        if (!availableGame) {
          const game = new Game(
            gameFromDb?.whitePlayerId!,
            gameFromDb?.blackPlayerId!,
            gameFromDb.id,
            gameFromDb.startAt,
          );
          this.games.push(game);
          availableGame = game;
        }

        user.socket.send(
          JSON.stringify({
            type: GAME_JOINED,
            payload: {
              gameId,
              blackPlayer: {
                id: gameFromDb.blackPlayer?.id,
                name: gameFromDb.blackPlayer?.username,
              },
              whitePlayer: {
                id: gameFromDb.whitePlayer.id,
                name: gameFromDb.whitePlayer.username,
              },
            },
          }),
        );

        socketManager.addUser(user, gameId);
      }
    });
  }
}