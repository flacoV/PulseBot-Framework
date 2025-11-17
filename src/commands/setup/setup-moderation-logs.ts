import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel
} from "discord.js";

import { configurationService } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";

const builder = new SlashCommandBuilder()
  .setName("setup-moderation-logs")
  .setDescription("Configura el canal donde se registrarán todas las acciones de moderación.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription("Canal donde se enviarán los logs de moderación.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ flags: "Ephemeral" });

  const selectedChannel = interaction.options.getChannel("canal", true, [ChannelType.GuildText]);

  const channel = (await interaction.guild.channels
    .fetch(selectedChannel.id)
    .catch(() => null)) as TextChannel | null;

  if (!channel) {
    await interaction.editReply({
      content: "No pude encontrar ese canal. Intenta nuevamente.",
      embeds: []
    });
    return;
  }

  // Verificar permisos del bot en el canal
  const me = await interaction.guild.members.fetchMe();
  const botPermissions = channel.permissionsFor(me);

  if (!botPermissions?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
    await interaction.editReply({
      content:
        "El bot no tiene permisos suficientes en ese canal. Necesita: Ver Canal, Enviar Mensajes y Enviar Embeds.",
      embeds: []
    });
    return;
  }

  await configurationService.setModerationConfig(interaction.guildId, { logChannelId: channel.id });

  const embed = createBaseEmbed({
    title: "Canal de Logs Configurado",
    description: `El canal ${channel} ahora recibirá todos los logs de moderación.`,
    footerText: "Las acciones de warn, mute, kick y ban se registrarán aquí."
  }).addFields({
    name: "Canal",
    value: `${channel} (${channel.id})`
  });

  await interaction.editReply({
    content: "Configuración guardada correctamente.",
    embeds: [embed]
  });
};

const command: Command = {
  data: builder,
  execute,
  guildOnly: true,
  requiredPermissions: [PermissionFlagsBits.ManageGuild],
  access: "staff"
};

export default command;

