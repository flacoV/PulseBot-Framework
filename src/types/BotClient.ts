import type { Client, Collection } from "discord.js";

import type { Command } from "./Command.js";

export type BotClient = Client & {
  commands: Collection<string, Command>;
};


