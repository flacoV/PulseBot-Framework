import type { GuildMember, User } from "discord.js";

export interface WelcomePlaceholderContext {
  userMention: string;
  userName: string;
  userDisplayName: string;
  userTag: string;
  guildName: string;
}

const PLACEHOLDER_ALIASES: Record<string, keyof WelcomePlaceholderContext> = {
  user: "userMention",
  usermention: "userMention",
  mention: "userMention",
  username: "userName",
  user_name: "userName",
  userdisplayname: "userDisplayName",
  displayname: "userDisplayName",
  nickname: "userDisplayName",
  usertag: "userTag",
  tag: "userTag",
  guild: "guildName",
  guildname: "guildName",
  server: "guildName",
  servername: "guildName"
};

const sanitizePlaceholderKey = (placeholder: string) =>
  placeholder.replace(/[\s_-]/g, "").toLowerCase();

export const renderWelcomeTemplate = (template: string, context: WelcomePlaceholderContext) =>
  template.replace(/{{\s*([\w-]+)\s*}}/g, (match: string, rawKey: string) => {
    const normalizedKey = sanitizePlaceholderKey(rawKey);
    const contextKey = PLACEHOLDER_ALIASES[normalizedKey];

    if (!contextKey) {
      return match;
    }

    return context[contextKey] ?? match;
  });

export const DEFAULT_WELCOME_TEMPLATE =
  "Welcome {{userMention}}! Take a look at the rules and enjoy your stay in {{guildName}}.";

const buildUserTag = (user: User) =>
  user.discriminator && user.discriminator !== "0"
    ? `${user.username}#${user.discriminator}`
    : user.username;

export const createWelcomeContext = (member: GuildMember): WelcomePlaceholderContext => ({
  userMention: member.toString(),
  userName: member.user.username,
  userDisplayName: member.displayName ?? member.user.globalName ?? member.user.username,
  userTag: buildUserTag(member.user),
  guildName: member.guild.name
});

export const createPreviewContext = (
  user: User,
  guildName: string,
  displayName?: string | null
): WelcomePlaceholderContext => ({
  userMention: user.toString(),
  userName: user.username,
  userDisplayName: displayName ?? user.globalName ?? user.username,
  userTag: buildUserTag(user),
  guildName
});

