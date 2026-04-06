const {

  SlashCommandBuilder,

  EmbedBuilder,

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle,

  ModalBuilder,

  TextInputBuilder,

  TextInputStyle,

  StringSelectMenuBuilder,

  PermissionsBitField,

  ChannelType,

  MessageFlags

} = require('discord.js');



const TICKET_CATEGORY = '1486462584835280897';

const TICKET_SUPPORT_ROLE_IDS = ['1485015881657483264', '1486463263523995742'];

const TICKET_BUTTON_IDS = {
  title: 'ticket-button-title',
  description: 'ticket-button-description',
  supports: 'ticket-button-supports',
  image: 'ticket-button-image',
  send: 'ticket-button-send',
  close: 'ticket-button-close',
  delete: 'ticket-button-delete'
};
const TICKET_FIELD_BUTTON_IDS = [
  TICKET_BUTTON_IDS.title,
  TICKET_BUTTON_IDS.description,
  TICKET_BUTTON_IDS.supports,
  TICKET_BUTTON_IDS.image,
  TICKET_BUTTON_IDS.send
];
const TICKET_CHANNEL_BUTTON_IDS = [TICKET_BUTTON_IDS.close, TICKET_BUTTON_IDS.delete];
const TICKET_MODAL_IDS = {

  title: 'ticket-modal-title',

  description: 'ticket-modal-description',

  supports: 'ticket-modal-supports'

};

const TICKET_SELECT_ID = 'ticket-support-select';



const ticketStates = new Map();



const defaultTicketState = () => ({

  title: 'Pedido de Suporte',

  description: 'Descreva o que precisa.',

  supports: [],

  supportsText: '',

  image: null

});



const sanitizeChannelName = (value = '') =>

  `ticket-${value}`

    .toLowerCase()

    .replace(/[^a-z0-9_-]/g, '-')

    .replace(/^-+|-+$/g, '');



const buildTicketEmbed = (state) => {

  const embed = new EmbedBuilder()

    .setTitle(state.title || 'Ticket')

    .setDescription(state.description || 'Use os botões para configurar o painel.')

    .setColor(0x00a65a);

  if (state.image) {

    embed.setImage(state.image);

  }

  return embed;

};



const promptTicketImageUpload = async (interaction, state) => {

  const channel = interaction.channel;

  if (!channel) {

    await interaction.reply({ content: 'Não consegui acessar este canal para receber a imagem.', flags: MessageFlags.Ephemeral });

    return;

  }

  await interaction.reply({

    content: 'Envie uma imagem como anexo neste canal. Eu vou salvar o primeiro arquivo que você enviar nos próximos 60 segundos.',

    flags: MessageFlags.Ephemeral

  });

  try {

    const filter = (message) => message.author.id === interaction.user.id && message.attachments.size > 0;

    const collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });

    const attachment = collected.first().attachments.first();

    state.image = attachment.url;

    await interaction.followUp({ content: 'Imagem registrada com sucesso.', flags: MessageFlags.Ephemeral });

  } catch {

    await interaction.followUp({ content: 'Nenhuma imagem foi enviada a tempo.', flags: MessageFlags.Ephemeral });

  }

};



const buildTicketButtons = () => {

  const row1 = new ActionRowBuilder().addComponents(

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.title).setLabel('Título').setStyle(ButtonStyle.Secondary),

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.description).setLabel('Descrição').setStyle(ButtonStyle.Secondary),

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.supports).setLabel('Suportes').setStyle(ButtonStyle.Secondary),

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.image).setLabel('Imagem').setStyle(ButtonStyle.Secondary)

  );

  const row2 = new ActionRowBuilder().addComponents(

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.send).setLabel('Enviar painel').setStyle(ButtonStyle.Success)

  );

  return [row1, row2];

};



const buildTicketSelect = (state) => {

  const options = (state.supports || []).slice(0, 25).map((support) => ({

    label: support,

    value: support,

    description: `Clique para abrir`

  }));

  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(

    new StringSelectMenuBuilder()

      .setCustomId(TICKET_SELECT_ID)

      .setPlaceholder('Selecione uma opção...')

      .addOptions(options)

  );

};



const ticketFieldModalConfig = {

  title: { id: TICKET_MODAL_IDS.title, label: 'Título', style: TextInputStyle.Short, placeholder: 'Nome do painel' },

  description: {

    id: TICKET_MODAL_IDS.description,

    label: 'Descrição',

    style: TextInputStyle.Paragraph,

    placeholder: 'Escreva o texto explicando o ticket'

  },

  supports: {

    id: TICKET_MODAL_IDS.supports,

    label: 'Suportes (um por linha)',

    style: TextInputStyle.Paragraph,

    placeholder: 'Suporte 1\nSuporte 2'

  }

};



const getTicketState = (userId) => {

  if (!ticketStates.has(userId)) {

    ticketStates.set(userId, defaultTicketState());

  }

  return ticketStates.get(userId);

};



const buildTicketModal = (field, state) => {

  const config = ticketFieldModalConfig[field];

  if (!config) return null;

  const modal = new ModalBuilder().setCustomId(config.id).setTitle(config.label);

  const input = new TextInputBuilder()

    .setCustomId(field)

    .setLabel(config.label)

    .setStyle(config.style)

    .setPlaceholder(config.placeholder)

    .setRequired(true);

  if (field === 'supports' && state.supportsText) {

    input.setValue(state.supportsText);

  } else if (state[field]) {

    input.setValue(state[field].toString());

  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return modal;

};



const buildTicketChannelEmbed = (user, support) =>

  new EmbedBuilder()

    .setTitle('Novo Ticket')

    .setDescription(
      '👋 Olá! Seja bem-vindo(a) ao suporte da VgN.\n\n' +
        'Para que possamos te ajudar da melhor forma possível, descreva detalhadamente o seu problema.\n\n' +
        '⏳ Nossa equipe irá analisar e responder o mais rápido possível.\n\n' +
        'Agradecemos pela sua paciência!\n\n' +
        `Suporte: ${support}\nCliente: <@${user.id}>`
    )

    .setColor(0x00a65a);



const handleTicketCommand = async (interaction) => {

  const state = getTicketState(interaction.user.id);

  await interaction.reply({

    embeds: [buildTicketEmbed(state)],

    components: buildTicketButtons(),

    flags: MessageFlags.Ephemeral

  });

};



const handleTicketFieldButton = async (interaction) => {

  const state = getTicketState(interaction.user.id);

  switch (interaction.customId) {

    case TICKET_BUTTON_IDS.title:
      await interaction.showModal(buildTicketModal('title', state));
      break;

    case TICKET_BUTTON_IDS.description:
      await interaction.showModal(buildTicketModal('description', state));
      break;

    case TICKET_BUTTON_IDS.supports:
      await interaction.showModal(buildTicketModal('supports', state));
      break;

    case TICKET_BUTTON_IDS.image:

      await promptTicketImageUpload(interaction, state);

      break;

    case TICKET_BUTTON_IDS.send:

      await handleSendTicketPanel(interaction, state);

      break;

  }

};



const handleSendTicketPanel = async (interaction, state) => {

  if (!state.supports?.length) {

    await interaction.reply({ content: 'Informe pelo menos um suporte.', flags: MessageFlags.Ephemeral });

    return;

  }

  const embed = buildTicketEmbed(state);

  const selectRow = buildTicketSelect(state);

  await interaction.channel.send({ embeds: [embed], components: selectRow ? [selectRow] : [] });

  await interaction.reply({ content: 'Painel de tickets publicado.', flags: MessageFlags.Ephemeral });

};



const openTicketChannel = async (client, interaction, support) => {

  const guild = interaction.guild;

  if (!guild) return;

  const channelName = sanitizeChannelName(`${support}-${interaction.user.username}`);

  const overwrites = [

    {

      id: guild.roles.everyone.id,

      deny: [PermissionsBitField.Flags.ViewChannel]

    },

    {

      id: interaction.user.id,

      allow: [

        PermissionsBitField.Flags.ViewChannel,

        PermissionsBitField.Flags.SendMessages,

        PermissionsBitField.Flags.ReadMessageHistory

      ]

    }

  ];

  for (const roleId of TICKET_SUPPORT_ROLE_IDS) {

    overwrites.push({

      id: roleId,

      allow: [

        PermissionsBitField.Flags.ViewChannel,

        PermissionsBitField.Flags.SendMessages,

        PermissionsBitField.Flags.ReadMessageHistory

      ]

    });

  }

  const channel = await guild.channels.create({

    name: channelName,

    type: ChannelType.GuildText,

    parent: TICKET_CATEGORY,

    permissionOverwrites: overwrites,

    reason: 'Ticket aberto pelo bot'

  });

  const row = new ActionRowBuilder().addComponents(

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.close).setLabel('Fechar Ticket').setStyle(ButtonStyle.Secondary),

    new ButtonBuilder().setCustomId(TICKET_BUTTON_IDS.delete).setLabel('Excluir ticket').setStyle(ButtonStyle.Danger)

  );

  await channel.send({ embeds: [buildTicketChannelEmbed(interaction.user, support)], components: [row] });

  await interaction.reply({

    content: `Criei o ticket ${channel} para ${support}.`,

    flags: MessageFlags.Ephemeral

  });

};



const canUseTicketButtons = (interaction) =>

  interaction.member?.roles.cache.some((role) => TICKET_SUPPORT_ROLE_IDS.includes(role.id));



const handleTicketSupportSelect = async (interaction) => {

  const support = interaction.values[0];

  if (!support) {

    await interaction.reply({ content: 'Seleção inválida.', flags: MessageFlags.Ephemeral });

    return;

  }

  await openTicketChannel(interaction.client, interaction, support);

};



const handleTicketChannelButton = async (interaction) => {

  if (!canUseTicketButtons(interaction)) {

    await interaction.reply({ content: 'Você não tem permissão para usar este botão.', flags: MessageFlags.Ephemeral });

    return;

  }

  const channel = interaction.channel;

  if (!channel?.isTextBased()) {

    await interaction.reply({ content: 'Não consegui acessar o canal.', flags: MessageFlags.Ephemeral });

    return;

  }

  if (interaction.customId === TICKET_BUTTON_IDS.close) {

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: false }).catch(() => null);

    await interaction.reply({ content: 'Ticket fechado (canal trancado).', flags: MessageFlags.Ephemeral });

    return;

  }

  if (interaction.customId === TICKET_BUTTON_IDS.delete) {

    await interaction.reply({ content: 'Ticket será excluído em instantes.', flags: MessageFlags.Ephemeral });

    setTimeout(() => {

      channel.delete('Ticket excluído pelo botão').catch(() => null);

    }, 2000);

  }

};



module.exports = {

  data: new SlashCommandBuilder().setName('ticket').setDescription('Abra um painel para criar um ticket.'),

  execute: handleTicketCommand,

  buttonIds: Object.values(TICKET_BUTTON_IDS),

  fieldButtonIds: TICKET_FIELD_BUTTON_IDS,

  channelButtonIds: TICKET_CHANNEL_BUTTON_IDS,

  modalIds: Object.values(TICKET_MODAL_IDS),

  selectId: TICKET_SELECT_ID,

  handleFieldButton: handleTicketFieldButton,

  handleModalSubmit: async (interaction) => {

    const state = getTicketState(interaction.user.id);

    const field = interaction.customId.replace('ticket-modal-', '');

    const value = interaction.fields.getTextInputValue(field);

    if (field === 'supports') {

      const supports = value

        .split(/\r?\n/)

        .map((line) => line.trim())

        .filter(Boolean);

      state.supports = supports;

      state.supportsText = supports.join('\n');

    } else {

      state[field] = value;

    }

    await interaction.reply({ content: `${field.charAt(0).toUpperCase() + field.slice(1)} atualizado.`, flags: MessageFlags.Ephemeral });

  },

  handleSupportSelect: handleTicketSupportSelect,

  handleChannelButton: handleTicketChannelButton

};

