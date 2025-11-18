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
  .setDescription("Registra una advertencia en el historial de un miembro.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a advertir.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("razon")
      .setDescription("Motivo de la advertencia.")
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("evidencia")
      .setDescription("URLs o referencias, separadas por espacios o comas (máximo 5).")
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  const guild = interaction.guild;
  const targetUser = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("razon", true).trim();
  const evidence = formatEvidence(interaction.options.getString("evidencia"));

  if (targetUser.bot) {
    await interaction.reply({
      content: "No puedes advertir a un bot.",
      ephemeral: true
    });
    return;
  }

  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id, cache: true }).catch(() => null);

  if (!ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.reply({
      content:
        "No puedes advertir a este miembro. Asegúrate de que tu rol sea superior y que no seas tú mismo.",
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
    title: `Advertencia #${moderationCase.caseId}`,
    description: `Se registró una advertencia para ${targetUser}.\n> ${reason}`,
    footerText: "Usa /infractions para revisar el historial completo."
  })
    .addFields(
      {
        name: "Moderador",
        value: `<@${interaction.user.id}>`,
        inline: true
      },
      {
        name: "Miembro",
        value: `<@${targetUser.id}>`,
        inline: true
      },
      {
        name: "Total de advertencias",
        value: `${stats.typeCounts.warn ?? 0}`,
        inline: true
      }
    );

  if (evidence.length) {
    embed.addFields({
      name: "Evidencia",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  if (stats.lastAction) {
    embed.addFields({
      name: "Última acción registrada",
      value: `#${stats.lastAction.caseId} · ${stats.lastAction.type} · <t:${Math.floor(
        stats.lastAction.createdAt.getTime() / 1000
      )}:R>`
    });
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
    content: "Advertencia registrada correctamente."
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
      logger.debug("Error al obtener invite o enviar DM en warn:", error);
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


