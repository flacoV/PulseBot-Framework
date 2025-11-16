import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import type { Command } from "../../types/Command.js";
import type { ModerationActionType } from "../../types/Moderation.js";
import { getUserCases, getUserStats } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { logger } from "../../utils/logger.js";

const actionChoices: { name: string; value: ModerationActionType; icon: string }[] = [
  { name: "Advertencias", value: "warn", icon: "🔔" },
  { name: "Silencios", value: "mute", icon: "🔇" },
  { name: "Expulsiones", value: "kick", icon: "👋" },
  { name: "Baneos", value: "ban", icon: "🔨" },
  { name: "Notas", value: "note", icon: "📝" }
];

const builder = new SlashCommandBuilder()
  .setName("infractions")
  .setDescription("Consulta el historial disciplinario de un miembro.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a consultar.").setRequired(true)
  )
  .addStringOption((option) => {
    option.setName("tipo").setDescription("Opcional: Filtra por tipo específico o busca todos los tipos.");
    actionChoices.forEach((choice) => option.addChoices(choice));
    return option;
  });

const formatCaseLine = (modCase: {
  caseId: number;
  type: ModerationActionType;
  reason: string;
  createdAt: Date;
  moderatorId: string;
}) => {
  const timestamp = `<t:${Math.floor(new Date(modCase.createdAt).getTime() / 1000)}:R>`;
  return `#${modCase.caseId} · **${modCase.type.toUpperCase()}** · ${timestamp}\n> ${modCase.reason}\n> Responsable: <@${modCase.moderatorId}>`;
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);
  const typeFilter = interaction.options.getString("tipo") as ModerationActionType | null;

  await interaction.deferReply();

  const caseQueryOptions = typeFilter ? { type: typeFilter } : undefined;

  const [cases, stats] = await Promise.all([
    getUserCases(interaction.guildId, targetUser.id, caseQueryOptions),
    getUserStats(interaction.guildId, targetUser.id)
  ]);

  if (cases.length === 0) {
    await interaction.editReply({
      content: "No se encontraron registros para este miembro con los filtros seleccionados.",
      embeds: []
    });
    return;
  }

  const formatCount = (value?: number) => (value && value > 0 ? `${value}` : "N/A");
  const summaryLines = actionChoices
    .map((choice) => `${choice.icon} ${choice.name}: ${formatCount(stats.typeCounts[choice.value])}`)
    .join("\n");

  const totalForView = typeFilter ? stats.typeCounts[typeFilter] ?? 0 : stats.totalCases;
  const lastCaseForView = typeFilter ? cases[0] : stats.lastAction;

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  let currentPage = 0;

  const buildPageEmbed = (page: number) => {
    const baseEmbed = createBaseEmbed({
      title: `Historial de ${targetUser.username}`,
      description: `Se encontraron ${cases.length} registro(s)${
        typeFilter ? ` de tipo ${typeFilter}` : ""
      }.`,
      footerText: "Los datos se almacenan en MongoDB para auditorías futuras."
    });

    baseEmbed.addFields(
      {
        name: typeFilter ? `Total ${typeFilter}` : "Total de casos",
        value: formatCount(totalForView),
        inline: true
      },
      {
        name: "Última acción",
        value: lastCaseForView
          ? `#${lastCaseForView.caseId} · ${lastCaseForView.type} · <t:${Math.floor(
              new Date(lastCaseForView.createdAt).getTime() / 1000
            )}:R>`
          : "N/A",
        inline: true
      }
    );

    if (!typeFilter) {
      baseEmbed.addFields({
        name: "Totales por tipo",
        value: summaryLines
      });
    }

    const start = page * pageSize;
    const slice = cases.slice(start, start + pageSize);

    const caseChunks = slice.map((modCase) => formatCaseLine(modCase));
    baseEmbed.addFields({
      name: `Registros (página ${page + 1}/${totalPages})`,
      value: caseChunks.join("\n\n")
    });

    return baseEmbed;
  };

  const components =
    totalPages > 1
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("infractions_prev")
              .setEmoji("⬅️")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("infractions_next")
              .setEmoji("➡️")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("infractions_close")
              .setEmoji("🗑️")
              .setStyle(ButtonStyle.Danger)
          )
        ]
      : [];

  const initialMessage = await interaction.editReply({
    content: null,
    embeds: [buildPageEmbed(currentPage)],
    components
  });

  if (totalPages === 1) return;

  const collector = initialMessage.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id,
    time: 60_000
  });

  collector.on("collect", async (i) => {
    try {
      await i.deferUpdate();

      if (i.customId === "infractions_close") {
        collector.stop("closed");
        await initialMessage.edit({
          embeds: [buildPageEmbed(currentPage)],
          components: []
        });
        return;
      }

      if (i.customId === "infractions_prev") {
        currentPage = currentPage === 0 ? totalPages - 1 : currentPage - 1;
      } else if (i.customId === "infractions_next") {
        currentPage = currentPage === totalPages - 1 ? 0 : currentPage + 1;
      }

      await initialMessage.edit({
        embeds: [buildPageEmbed(currentPage)],
        components
      });
    } catch (error) {
      logger.error("Error al procesar la paginación de /infractions.", error);
    }
  });

  collector.on("end", async () => {
    try {
      await initialMessage.edit({
        embeds: [buildPageEmbed(currentPage)],
        components: []
      });
    } catch {
      // mensaje borrado, ignorar
    }
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


