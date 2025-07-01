import { Bot } from "./Bot";

export type BotRunnerConfig = {
  serverUrl: string;
  updateInterval: number;
  randomRange: number;
  logStatusInterval: number;
  colorStateId?: number;
  yValue: number;
};

export interface BotConfig {
  id: number;
  updateInterval?: number;
  valuesToUpdate?: number[];
  randomRange: number;
  yValue: number;
  colorStateId?: number;
}

export class BotRunner {
  private bots: Bot[] = [];
  private statusIntervalId: NodeJS.Timeout | null = null;

  constructor(private readonly config: BotRunnerConfig) {}

  public addBot(config: BotConfig): Bot {
    const bot = new Bot(this.config.serverUrl, config);
    this.bots.push(bot);
    return bot;
  }

  public startAll(): void {
    for (const bot of this.bots) {
      bot.start();
    }

    if (this.config.logStatusInterval > 0) {
      this.statusIntervalId = setInterval(() => {
        this.logStatus();
      }, this.config.logStatusInterval);
    }
  }

  public stopAll(): void {
    for (const bot of this.bots) {
      bot.stop();
    }

    if (this.statusIntervalId) {
      clearInterval(this.statusIntervalId);
      this.statusIntervalId = null;
    }
  }

  public getBots(): Bot[] {
    return [...this.bots];
  }

  private logStatus(): void {
    console.log("=== Bot Runner Status ===");
    console.log(`Total bots: ${this.bots.length}`);
    for (const bot of this.bots) {
      console.log(bot.getStatus());
    }
    console.log("========================");
  }

  public addRandomBots(count: number): Bot[] {
    const newBots: Bot[] = [];

    for (let i = 0; i < count; i++) {
      const config: BotConfig = {
        id: i,
        yValue: this.config.yValue,
        updateInterval: this.config.updateInterval,
        randomRange: this.config.randomRange,
        colorStateId: this.config.colorStateId,
      };

      const bot = this.addBot(config);
      newBots.push(bot);
    }

    return newBots;
  }
}
