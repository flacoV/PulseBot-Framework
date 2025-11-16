import type { Client, Collection } from "discord.js";

import type { Command } from "./Command.js";

export type WelcomeDedupCache = Map<string, Map<string, NodeJS.Timeout>>;
export type MuteReleaseTimers = Map<string, NodeJS.Timeout>;

export interface BotClient extends Client {
  commands: Collection<string, Command>;
  welcomeDedupCache: WelcomeDedupCache;
  muteReleaseTimers: MuteReleaseTimers;
}

