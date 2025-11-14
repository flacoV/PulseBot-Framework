import type { Client, Collection } from "discord.js";

import type { Command } from "./Command.js";

type WelcomeDedupCache = Map<string, Map<string, NodeJS.Timeout>>;

export type BotClient = Client & {
  commands: Collection<string, Command>;
  welcomeDedupCache: WelcomeDedupCache;
};

export type { WelcomeDedupCache };

