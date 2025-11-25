import { Colors, EmbedBuilder } from "discord.js";

interface BaseEmbedOptions {
  title?: string;
  description?: string;
  color?: number;
  footerText?: string;
  thumbnailUrl?: string;
}

/**
 * Creates a standardized embed to maintain visual consistency.
 */
export const createBaseEmbed = ({
  title,
  description,
  color,
  footerText,
  thumbnailUrl
}: BaseEmbedOptions) => {
  const embed = new EmbedBuilder()
    .setColor(color ?? Colors.Blurple)
    .setTimestamp(Date.now());

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footerText) embed.setFooter({ text: footerText });
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  return embed;
};

/**
 * Custom colors for the welcome embed
 * Inspired by a purple/dark blue scheme with vibrant touches
 */
const WELCOME_COLORS = {
  primary: 0x6b46c1, // Vibrant purple
  secondary: 0x4c1d95, // Dark purple
  accent: 0x8b5cf6, // Light purple
  gradient: [0x6b46c1, 0x4c1d95, 0x7c3aed] as const
} as const;

interface WelcomeEmbedOptions {
  userAvatarUrl: string;
  description: string;
  guildName: string;
  memberCount?: number;
}

/**
 * Creates a welcome embed with modern visual style.
 * Includes the user's avatar, custom purple/dark blue colors
 * and a more attractive format similar to popular bots.
 */
export const createWelcomeEmbed = ({
  userAvatarUrl,
  description,
  guildName,
  memberCount
}: WelcomeEmbedOptions) => {
  // Use the primary color of the welcome scheme (vibrant purple)
  const embed = new EmbedBuilder()
    .setColor(WELCOME_COLORS.primary)
    .setAuthor({
      name: "WELCOME",
      iconURL: userAvatarUrl
    })
    .setThumbnail(userAvatarUrl)
    .setDescription(description)
    .setFooter({
      text: memberCount
        ? `${guildName} • Member #${memberCount.toLocaleString()}`
        : guildName
    })
    .setTimestamp(Date.now());

  return embed;
};


