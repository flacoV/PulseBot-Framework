import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import type { Command } from "../../types/Command.js";
import { createModerationCase } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { sendModerationDm } from "../../utils/moderationDm.js";
import { getOrCreatePermanentInvite } from "../../utils/inviteHelper.js";
import { logger } from "../../utils/logger.js";
import { logModerationAction } from "../../utils/moderationLogger.js";

const formatEvidence = (raw?: string | null) => {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
};

const ensureHierarchy = (moderator: GuildMember, target?: GuildMember | null) => {
  if (!target) return true;
  if (target.id === moderator.id) return false;
  if (target.id === moderator.guild.ownerId) return false;

  return moderator.roles.highest.comparePositionTo(target.roles.highest) > 0;
};

const builder = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick a member from the server and record the action.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("User to kick.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the kick.")
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("evidence")
      .setDescription("URLs or references, separated by spaces or commas (maximum 5).")
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  const guild = interaction.guild;
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true).trim();
  const evidence = formatEvidence(interaction.options.getString("evidence"));

  if (targetUser.bot) {
    await interaction.reply({
      content: "You cannot kick a bot with this command.",
      ephemeral: true
    });
    return;
  }

  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "I was unable to get the specified member. They may have already left the server.",
      ephemeral: true
    });
    return;
  }

  if (!ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.reply({
      content: "You cannot kick this member. Verify the role hierarchy.",
      ephemeral: true
    });
    return;
  }

  await targetMember.kick(`Kick by ${interaction.user.tag}: ${reason}`);

  await createModerationCase(
    {
      guildId: guild.id,
      userId: targetUser.id,
      moderatorId: interaction.user.id,
      type: "kick",
      reason,
      evidenceUrls: evidence
    },
    { generateCaseId: false }
  );

  const embed = createBaseEmbed({
    title: "Kick applied",
    description: `${targetUser.tag} has been kicked from the server.`,
    footerText: "Use /infractions to review the full history."
  }).addFields(
    {
      name: "Moderator",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Member",
      value: `${targetUser.tag} (${targetUser.id})`,
      inline: true
    },
    {
      name: "Reason",
      value: reason
    }
  );

  if (evidence.length) {
    embed.addFields({
      name: "Evidence",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  await interaction.reply({
    content: "Kick executed successfully.",
    embeds: [embed],
    ephemeral: true
  });

  // Enviar DM con invite (sin bloquear la respuesta)
  getOrCreatePermanentInvite(guild)
    .then((inviteUrl) =>
      sendModerationDm({
        user: targetUser,
        guildName: guild.name,
        type: "kick",
        reason,
        inviteUrl
      })
    )
    .catch((error) => {
      logger.debug("Error getting invite or sending DM in kick:", error);
    });

  // Enviar log al canal de moderación
  await logModerationAction({
    guild,
    actionType: "kick",
    targetUser: {
      id: targetUser.id,
      tag: targetUser.tag,
      username: targetUser.username
    },
    moderator: {
      id: interaction.user.id,
      tag: interaction.user.tag
    },
    reason,
    evidenceUrls: evidence
  });
};

const command: Command = {
  data: builder,
  execute,
  guildOnly: true,
  requiredPermissions: [PermissionFlagsBits.KickMembers],
  access: "staff"
};

export default command;


