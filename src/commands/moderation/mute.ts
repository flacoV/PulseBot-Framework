import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import type { Command } from "../../types/Command.js";
import type { CreateModerationCaseInput } from "../../types/Moderation.js";
import { configurationService } from "../../services/configurationService.js";
import { createModerationCase } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { formatDuration, parseDurationInput } from "../../utils/duration.js";

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
  .setName("mute")
  .setDescription("Silencia a un miembro aplicando el rol configurado.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a silenciar.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("razon")
      .setDescription("Motivo del mute.")
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("duracion")
      .setDescription("Duración (ej: 30m, 2h, 1d). Máximo 30 días.")
      .setRequired(false)
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

  const moderationConfig = await configurationService.getModerationConfig(interaction.guildId);
  if (!moderationConfig?.muteRoleId) {
    await interaction.reply({
      content: "Aún no se ha configurado el rol de mute. Usa /setup-mute-role antes de continuar.",
      ephemeral: true
    });
    return;
  }

  const muteRole = interaction.guild.roles.cache.get(moderationConfig.muteRoleId);
  if (!muteRole) {
    await interaction.reply({
      content:
        "El rol configurado para los mutes ya no existe. Configúralo nuevamente con /setup-mute-role.",
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("razon", true).trim();
  const durationInput = interaction.options.getString("duracion");
  const evidence = formatEvidence(interaction.options.getString("evidencia"));

  if (targetUser.bot) {
    await interaction.reply({
      content: "No puedes silenciar a un bot.",
      ephemeral: true
    });
    return;
  }

  const guild = interaction.guild;
  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (!ensureHierarchy(moderatorMember, targetMember ?? null)) {
    await interaction.reply({
      content: "No puedes silenciar a este miembro. Verifica la jerarquía de roles.",
      ephemeral: true
    });
    return;
  }

  if (!targetMember) {
    await interaction.reply({
      content: "No pude obtener al miembro especificado. Inténtalo nuevamente.",
      ephemeral: true
    });
    return;
  }

  if (targetMember.roles.cache.has(muteRole.id)) {
    await interaction.reply({
      content: "El miembro ya está silenciado.",
      ephemeral: true
    });
    return;
  }

  let durationMs: number | undefined;
  let expiresAt: Date | undefined;

  if (durationInput) {
    const parsed = parseDurationInput(durationInput);
    if (!parsed) {
      await interaction.reply({
        content:
          "Duración inválida. Usa formatos como 30m, 2h, 1d y un máximo de 30 días.",
        ephemeral: true
      });
      return;
    }
    durationMs = parsed;
    expiresAt = new Date(Date.now() + parsed);
  }

  await targetMember.roles.add(muteRole.id, `Mute aplicado por ${interaction.user.tag}: ${reason}`);

  const moderationPayload: CreateModerationCaseInput = {
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    type: "mute",
    reason,
    evidenceUrls: evidence,
    metadata: {
      muteRoleId: muteRole.id
    }
  };

  if (typeof durationMs === "number") {
    moderationPayload.durationMs = durationMs;
  }

  if (expiresAt) {
    moderationPayload.expiresAt = expiresAt;
  }

  const moderationCase = await createModerationCase(moderationPayload);

  const embed = createBaseEmbed({
    title: `Mute aplicado: caso #${moderationCase.caseId}`,
    description: `${targetUser} fue silenciado.`,
    footerText: "Recuerda remover el rol manualmente si no definiste duración."
  }).addFields(
    {
      name: "Moderador",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Duración",
      value: durationMs ? formatDuration(durationMs) : "Indefinido",
      inline: true
    },
    {
      name: "Motivo",
      value: reason
    }
  );

  if (expiresAt) {
    embed.addFields({
      name: "Expira",
      value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
    });
  }

  if (evidence.length) {
    embed.addFields({
      name: "Evidencia",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  await interaction.reply({
    content: "Se aplicó el mute correctamente.",
    embeds: [embed],
    ephemeral: true
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



