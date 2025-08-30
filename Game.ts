import { db } from './db';
import { randomUUID } from 'crypto';
import { socketManager, User } from './SocketManager';

import {
  GAME_ENDED,
  INIT_GAME,
} from './messages';

type GAME_STATUS = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'TIME_UP' | 'PLAYER_EXIT' | 'WAITING_FOR_PLAYERS';
type GAME_RESULT = "WHITE_WINS" | "BLACK_WINS" | "DRAW";

export class Game {
  public gameId: string;
  public player1UserId: string;
  public player2UserId: string | null;
  private timer: NodeJS.Timeout | null = null;
  private moveTimer: NodeJS.Timeout | null = null;
  public result: GAME_RESULT | null = null;
  private startTime = new Date(Date.now());
  private lastMoveTime = new Date(Date.now());

  constructor(player1UserId: string, player2UserId: string | null, gameId?: string, startTime?: Date) {
    this.player1UserId = player1UserId;
    this.player2UserId = player2UserId;
    this.gameId = gameId ?? randomUUID();
    if (startTime) {
      this.startTime = startTime;
      this.lastMoveTime = startTime;
    }
  }

  async updateSecondPlayer(player2UserId: string) {
    this.player2UserId = player2UserId;

    const users = await db.user.findMany({
      where: {
        id: {
          in: [this.player1UserId, this.player2UserId ?? ''],
        },
      },
    });

    try {
      await this.createGameInDb();
    } catch (e) {
      console.error(e);
      return;
    }

    const WhitePlayer = users.find((user) => user.id === this.player1UserId);
    const BlackPlayer = users.find((user) => user.id === this.player2UserId);

    socketManager.broadcast(
      this.gameId,
      JSON.stringify({
        type: INIT_GAME,
        payload: {
          gameId: this.gameId,
          whitePlayer: {
            name: WhitePlayer?.username,
            id: this.player1UserId,
          },
          blackPlayer: {
            name: BlackPlayer?.username,
            id: this.player2UserId,
          },
        },
      }),
    );
  }

  async createGameInDb() {
    this.startTime = new Date(Date.now());
    this.lastMoveTime = this.startTime;

    // This game is created when roomId is created 
    const game = await db.game.findUnique({
        where: {
            id: this.gameId,
        },
    });

    if(game){
        this.gameId = game.id;
        await db.game.update({
          where: {
            id: this.gameId,
          },
          data: {
            startAt: this.startTime,
            blackPlayer: {
              connect: {
                id: this.player2UserId ?? '',
              },
            },
            status: 'IN_PROGRESS',
          },
        });
        return;
    }

    const newGame = await db.game.create({
      data: {
        id: this.gameId,
        status: 'IN_PROGRESS',
        startAt: this.startTime,
        whitePlayer: {
          connect: {
            id: this.player1UserId,
          },
        },
        blackPlayer: {
          connect: {
            id: this.player2UserId ?? '',
          },
        },
      },
      include: {
        whitePlayer: true,
        blackPlayer: true,
      },
    });
    this.gameId = newGame.id;
  }



  async exitGame(user : User) {
    this.endGame('PLAYER_EXIT', user.userId === this.player2UserId ? 'WHITE_WINS' : 'BLACK_WINS');
  }

  async endGame(status: GAME_STATUS, result: GAME_RESULT) {

    const game = await db.game.findUnique({
        where: {
            id: this.gameId,
            status: 'WAITING_FOR_PLAYERS',
        },
    });
    if(game){
        // Game is not started yet 
        await db.game.delete({
            where: {
                id: this.gameId,
            },
        });
        this.clearTimer();
        this.clearMoveTimer();
        return;
    }

    const updatedGame = await db.game.update({
      data: {
        status,
        result: result,
      },
      where: {
        id: this.gameId,
      },
      include: {
        blackPlayer: true,
        whitePlayer: true,
      }
    });

    socketManager.broadcast(
      this.gameId,
      JSON.stringify({
        type: GAME_ENDED,
        payload: {
          result,
          status,
          blackPlayer: {
            id: updatedGame.blackPlayer?.id,
            name: updatedGame.blackPlayer?.username,
          },
          whitePlayer: {
            id: updatedGame.whitePlayer.id,
            name: updatedGame.whitePlayer.username,
          },
        },
      }),
    );
    // clear timers
    this.clearTimer();
    this.clearMoveTimer();
  }

  clearMoveTimer() {
    if(this.moveTimer) clearTimeout(this.moveTimer);
  }

  setTimer(timer: NodeJS.Timeout) {
    this.timer = timer;
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
  }
}