import { Colors, EmbedBuilder } from "discord.js";

interface BaseEmbedOptions {
  title?: string;
  description?: string;
  color?: number;
  footerText?: string;
  thumbnailUrl?: string;
}

/**
 * Crea un embed estandarizado para mantener consistencia visual.
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


