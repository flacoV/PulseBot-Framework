import type {
  ChatInputCommandInteraction,
  PermissionResolvable,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from "discord.js";

export type CommandAccess = "public" | "staff";

export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  guildOnly?: boolean;
  requiredPermissions?: PermissionResolvable[];
  cooldownSeconds?: number;
  access?: CommandAccess;
}

