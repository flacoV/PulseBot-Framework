import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import type { Command } from "../../types/Command.js";
import { createModerationCase, getUserStats } from "../../services/moderationService.js";
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
  .setName("warn")
  .setDescription("Registers a warning in the history of a member.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("Member to warn.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the warning.")
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
      content: "You cannot warn a bot.",
      ephemeral: true
    });
    return;
  }

  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id, cache: true }).catch(() => null);

  if (!ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.reply({
      content:
        "You cannot warn this member. Make sure your role is higher and you are not yourself.",
      ephemeral: true
    });
    return;
  }

  const moderationCase = await createModerationCase({
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    type: "warn",
    reason,
    evidenceUrls: evidence
  });

  const stats = await getUserStats(guild.id, targetUser.id);

  const embed = createBaseEmbed({
    title: `Warning #${moderationCase.caseId}`,
    description: `A warning was registered for ${targetUser}.\n> ${reason}`,
    footerText: "Use /infractions to review the full history."
  })
    .addFields(
      {
        name: "Moderator",
        value: `<@${interaction.user.id}>`,
        inline: true
      },
      {
        name: "Member",
        value: `<@${targetUser.id}>`,
        inline: true
      },
      {
        name: "Total warnings",
        value: `${stats.typeCounts.warn ?? 0}`,
        inline: true
      }
    );

  if (evidence.length) {
    embed.addFields({
      name: "Evidence",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  if (stats.lastAction) {
    embed.addFields({
      name: "Last action registered",
      value: `#${stats.lastAction.caseId} · ${stats.lastAction.type} · <t:${Math.floor(
        stats.lastAction.createdAt.getTime() / 1000
      )}:R>`
    });
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
    content: "Warning registered successfully."
  });

  // Enviar DM con invite (sin bloquear la respuesta)
  getOrCreatePermanentInvite(guild)
    .then((inviteUrl) =>
      sendModerationDm({
        user: targetUser,
        guildName: guild.name,
        type: "warn",
        caseId: moderationCase.caseId,
        reason,
        inviteUrl
      })
    )
    .catch((error) => {
      logger.debug("Error getting invite or sending DM in warn:", error);
    });

  // Enviar log al canal de moderación
  await logModerationAction({
    guild,
    actionType: "warn",
    caseId: moderationCase.caseId,
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
  requiredPermissions: [PermissionFlagsBits.ModerateMembers],
  access: "staff"
};

export default command;


