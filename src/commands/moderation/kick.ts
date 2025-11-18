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
  .setDescription("Expulsa a un miembro del servidor y registra la acción.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a expulsar.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("razon")
      .setDescription("Motivo del kick.")
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
      content: "No puedes expulsar a un bot con este comando.",
      ephemeral: true
    });
    return;
  }

  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "No pude obtener al miembro especificado. Es posible que ya haya abandonado el servidor.",
      ephemeral: true
    });
    return;
  }

  if (!ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.reply({
      content: "No puedes expulsar a este miembro. Verifica la jerarquía de roles.",
      ephemeral: true
    });
    return;
  }

  await targetMember.kick(`Kick por ${interaction.user.tag}: ${reason}`);

  const moderationCase = await createModerationCase({
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    type: "kick",
    reason,
    evidenceUrls: evidence
  });

  const embed = createBaseEmbed({
    title: `Kick aplicado: caso #${moderationCase.caseId}`,
    description: `${targetUser.tag} ha sido expulsado del servidor.`,
    footerText: "Usa /infractions para revisar el historial completo."
  }).addFields(
    {
      name: "Moderador",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Miembro",
      value: `${targetUser.tag} (${targetUser.id})`,
      inline: true
    },
    {
      name: "Motivo",
      value: reason
    }
  );

  if (evidence.length) {
    embed.addFields({
      name: "Evidencia",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  await interaction.reply({
    content: "Kick ejecutado correctamente.",
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
        caseId: moderationCase.caseId,
        reason,
        inviteUrl
      })
    )
    .catch((error) => {
      logger.debug("Error al obtener invite o enviar DM en kick:", error);
    });

  // Enviar log al canal de moderación
  await logModerationAction({
    guild,
    actionType: "kick",
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
  requiredPermissions: [PermissionFlagsBits.KickMembers],
  access: "staff"
};

export default command;


