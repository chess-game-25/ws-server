import type { Game } from "./Game";

export class GameManager {
    private games: Game[];

    public constructor(){
        this.games = [];
    }
}