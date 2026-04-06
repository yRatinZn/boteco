const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ChannelType,
  MessageFlags
} = require('discord.js');
const {
  ensureTable,
  ensureMetaRow,
  countStockRows,
  listUserTables,
  getProductMetadata,
  updateProduct,
  getCouponByCode
} = require('../database');

const PANEL_MENU_ID = 'painel-menu';
const PANEL2_MENU_ID = 'painel2-menu';
const FIELD_BUTTON_IDS = {
  title: 'painel1-button-title',
  description: 'painel1-button-description',
  image: 'painel1-button-image',
  color: 'painel1-button-color',
  price: 'painel1-button-price',
  stock: 'painel1-button-stock',
  name: 'painel1-button-name',
  sql: 'painel1-button-sql',
  sqlSelect: 'painel1-button-sql-select',
  send: 'painel1-button-send'
};

const SQL_TABLE_MENU_ID = 'painel1-sql-table-menu';

const MODAL_IDS = {
  title: 'painel1-modal-title',
  description: 'painel1-modal-description',
  color: 'painel1-modal-color',
  price: 'painel1-modal-price',
  stock: 'painel1-modal-stock',
  name: 'painel1-modal-name',
  sql: 'painel1-modal-sql',
  coupon: 'painel1-modal-coupon'
};

const menuOptions = [
  {
    label: 'Painel 1',
    value: 'painel1',
    description: 'Crie um painel com botão'
  },
  {
    label: 'Painel 2',
    value: 'painel2',
    description: 'Crie um painel com menu'
  }
];

const panel2MenuOptions = [
  {
    label: 'Detalhe A',
    value: 'painel2-a',
    description: 'Mostra informações sobre o detalhe A.'
  },
  {
    label: 'Detalhe B',
    value: 'painel2-b',
    description: 'Mostra informações sobre o detalhe B.'
  }
];

const stripMetaName = (value) => {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith('__meta__')) {
    return value.slice('__meta__'.length);
  }
  return value;
};

const userPanels = new Map();
const publishedPanels = new Map();
const BUY_CHANNEL_CATEGORY = '1486534097391059046';
const BUY_BUTTON_ID = 'painel1-buy';
const PUBLISHED_BUTTONS = [
  { id: 'painel1-pay', label: 'Ir para o Pagamento', style: ButtonStyle.Success, emoji: '1490116288456949780' },
  { id: 'painel1-edit-quantity', label: 'Editar Quantidade', style: ButtonStyle.Primary, emoji: '1490116084882477127' },
  { id: 'painel1-use-coupon', label: 'Usar cupom', style: ButtonStyle.Secondary, emoji: '1490116147553505300' },
  { id: 'painel1-cancel', label: 'Cancelar', style: ButtonStyle.Danger, emoji: '1490116217367953458' }
];
const PUBLISHED_BUTTON_IDS = PUBLISHED_BUTTONS.map((button) => button.id);

const painelEmbed = new EmbedBuilder()
  .setTitle('Painel interativo')
  .setDescription('Selecione o painel desejado para explorar os controles disponíveis.')
  .setColor(0x0099ff);

const buildMainMenu = () =>
  new StringSelectMenuBuilder()
    .setCustomId(PANEL_MENU_ID)
    .setPlaceholder('Escolha um painel...')
    .addOptions(menuOptions);

const buildPanel2Menu = () =>
  new StringSelectMenuBuilder()
    .setCustomId(PANEL2_MENU_ID)
    .setPlaceholder('Selecione um item do painel 2...')
    .addOptions(panel2MenuOptions);

const buildSqlTableMenuRow = async () => {
  try {
    const tables = await listUserTables();
    if (!tables.length) {
      return null;
    }
    const options = tables.slice(0, 25).map((table) => ({
      label: table,
      value: table,
      description: 'Use esta tabela no painel'
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(SQL_TABLE_MENU_ID)
      .setPlaceholder('Selecione uma tabela existente...')
      .addOptions(options);
    return new ActionRowBuilder().addComponents(menu);
  } catch {
    return null;
  }
};

const defaultPanel1State = () => ({
  title: 'Painel 1',
  description: 'Ajuste os campos clicando nos botões abaixo.',
  image: null,
  color: '#1d82f5',
  price: null,
  stock: null,
  name: null,
  sqlTable: 'Produtos1',
  cartQuantity: 1,
  appliedCoupon: null
});

const normalizeColor = (value) => {
  if (!value) return null;
  const raw = value.trim().replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw}`;
  }
  return null;
};

const getPanelColors = (state) => {
  const hex = normalizeColor(state.color);
  if (!hex) {
    return 0x1d82f5;
  }
  return parseInt(hex.replace('#', ''), 16);
};

const formatPrice = (price) => {
  if (price === null || price === undefined || price === '') return null;
  const value = Number(String(price).replace(',', '.'));
  if (Number.isNaN(value)) return null;
  return Number(value.toFixed(2));
};

const getStockValue = (stock) => {
  if (stock === null || stock === undefined || stock === '') return null;
  const value = Number(stock);
  if (Number.isNaN(value)) return null;
  return Math.floor(value);
};

const buildSnapshotFromState = (state) => ({
  title: state.title,
  description: state.description,
  image: state.image,
  color: state.color,
  name: state.name,
  cartQuantity: state.cartQuantity
});

const hydrateSnapshot = async (snapshot, tableName) => {
  const info = await getProductMetadata(tableName).catch(() => null);
  if (!info || !info.row) return null;
  return {
    ...snapshot,
    sqlTable: tableName,
    price: info.row.preco,
    stock: info.stock ?? 0,
    productId: info.row.id,
    name: stripMetaName(info.row.nome) || snapshot.name
  };
};

const registerPublishedPanel = (tableName, messageId, channelId, snapshot) => {
  if (!tableName) return;
  publishedPanels.set(tableName, { messageId, channelId, snapshot });
};

const refreshPublishedPanel = async (client, tableName) => {
  if (!tableName) return;
  const entry = publishedPanels.get(tableName);
  if (!entry) return;
  const channel = await client.channels.fetch(entry.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    publishedPanels.delete(tableName);
    return;
  }
  const message = await channel.messages.fetch(entry.messageId).catch(() => null);
  if (!message) {
    publishedPanels.delete(tableName);
    return;
  }
  const hydratedState = await hydrateSnapshot(entry.snapshot, tableName);
  if (!hydratedState) return;
  try {
    await message.edit({
      embeds: [buildPublishedEmbed(hydratedState)]
    });
  } catch (error) {
    console.error('Erro ao atualizar painel publicado:', error);
  }
};

const refreshStateFromDb = async (state) => {
  const loadFromTable = async (tableName) => {
    try {
      const info = await getProductMetadata(tableName);
      if (!info || !info.row) return false;
      const { row, stock } = info;
      state.sqlTable = tableName;
      state.productId = row.id;
      const cleanName = stripMetaName(row.nome);
      if (cleanName) {
        state.name = cleanName;
      }
      state.price = row.preco;
      state.stock = stock ?? 0;
      return true;
    } catch {
      return false;
    }
  };

  if (state.sqlTable && (await loadFromTable(state.sqlTable))) {
    return;
  }

  try {
    const tables = await listUserTables();
    for (const tableName of tables) {
      if (await loadFromTable(tableName)) {
        return;
      }
    }
  } catch {
    // unable to list tables
  }
};

const buildCartEmbed = (state) => {
  const cartQuantity = state.cartQuantity ?? 1;
  const basePrice = formatPrice(state.price);
  const discountPercent = state.appliedCoupon?.discount ?? 0;
  const discountedUnitPrice =
    basePrice !== null ? Number((basePrice * (1 - discountPercent / 100)).toFixed(2)) : null;
  const totalValue = discountedUnitPrice !== null ? Number((discountedUnitPrice * cartQuantity).toFixed(2)) : 0;
  const priceText =
    discountedUnitPrice !== null ? `R$${totalValue.toFixed(2).replace('.', ',')}` : 'R$0,00';
  const stockText = `${state.stock ?? 0}`;
  const cartText = `${cartQuantity}`;
  const desc = [
    'Fala, cliente! 👋',
    'Seu pedido já tá quase finalizado; 🚀',
    '',
    '📦 Confira seus itens e, quando estiver tudo certo, é só seguir com o pagamento.',
    '',
    '⚠️ Importante: após o pagamento, a entrega é feita automaticamente ou por um membro da equipe.',
    '',
    'Se tiver qualquer dúvida, chama o suporte que a gente te ajuda rapidinho 🤝',
    '',
    '🔥 Não perde tempo e finalize agora pra garantir sua compra!',
    '',
    `<:valor:1490117249002901704> **Valor à vista:**`,
    `\`\`${priceText}\`\``,
    `<:estoque:1490117287460601959> **Estoque:**`,
    `\`\`${stockText}\`\``,
    `<:carrinho:1490077438867411048> **Carrinho:**`,
    `\`\`${cartText}\`\``
  ];
  const couponCode = state.appliedCoupon?.code;
  const couponDiscount = Number(state.appliedCoupon?.discount ?? 0);
  if (couponCode && !Number.isNaN(couponDiscount) && couponDiscount > 0) {
    desc.push('', `Cupom aplicado: **${couponCode}** (-${couponDiscount.toFixed(2)}%)`);
  }
  return new EmbedBuilder().setTitle('Seu carrinho').setDescription(desc.join('\n'));
};

const updateCartMessage = async (state, client) => {
  const channelId = state.cartChannelId;
  const messageId = state.cartMessageId;
  if (!channelId || !messageId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    state.cartChannelId = null;
    state.cartMessageId = null;
    return;
  }
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    state.cartChannelId = null;
    state.cartMessageId = null;
    return;
  }
  try {
    await message.edit({ embeds: [buildCartEmbed(state)], components: [buildPublishedButtons()] });
  } catch (error) {
    console.error('Não consegui atualizar a embed do carrinho:', error);
  }
};

const buildPublishedEmbed = (state) => {
  const priceValue = formatPrice(state.price);
  const stockValue = getStockValue(state.stock);
  const cartQuantity = state.cartQuantity ?? 0;
  const totalValue =
    priceValue !== null && cartQuantity
      ? Number((priceValue * cartQuantity).toFixed(2))
      : priceValue;

  const embed = new EmbedBuilder()
    .setTitle(state.title || 'Painel 1')
    .setColor(getPanelColors(state));

  if (state.image) {
    embed.setImage(state.image);
  }

  const desc = state.description || 'Painel publicado.';
  const priceText = priceValue !== null ? `R$${priceValue.toFixed(2).replace('.', ',')}` : 'R$0,00';
  const stockText = stockValue !== null ? `${stockValue}` : '0';
  const layout = [
    `💸 | Preço: ${priceText}`,
    `📦 | Estoque: ${stockText}`
  ];
  embed.setDescription(`${desc}\n\n${layout.join('\n')}`);

  return embed;
};

const buildPublishedButtons = () =>
  new ActionRowBuilder().addComponents(
    PUBLISHED_BUTTONS.map((button) => {
      const builder = new ButtonBuilder()
        .setCustomId(button.id)
        .setLabel(button.label)
        .setStyle(button.style);
      if (button.emoji) {
        builder.setEmoji(button.emoji);
      }
      return builder;
    })
  );

const buildPanel1Embed = (state) => {
  const embed = new EmbedBuilder()
    .setTitle(state.title || 'Painel 1')
    .setDescription(state.description || 'Clique nos botões para preencher as informações.')
    .setColor(getPanelColors(state));

  if (state.image) {
    embed.setImage(state.image);
  }

  const fields = [];
  if (state.name) {
    fields.push({ name: 'Produto', value: state.name, inline: true });
  }
  if (state.price !== null && state.price !== undefined) {
    fields.push({ name: 'Preço', value: state.price.toString(), inline: true });
  }
  if (state.stock !== null && state.stock !== undefined) {
    fields.push({ name: 'Estoque', value: state.stock.toString(), inline: true });
  }
  if (state.sqlTable) {
    fields.push({ name: 'Tabela SQL', value: state.sqlTable, inline: true });
  }

  if (fields.length) {
    embed.setFields(fields);
  }

  return embed;
};

const buildPanel1Buttons = () => {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.title)
      .setLabel('Título')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.description)
      .setLabel('Descrição')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.image)
      .setLabel('Imagem')
      .setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.color)
      .setLabel('Cor')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.price)
      .setLabel('Preço')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.stock)
      .setLabel('Estoque')
      .setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.name)
      .setLabel('Name')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.sql)
      .setLabel('SQL')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.send)
      .setLabel('Enviar painel')
      .setStyle(ButtonStyle.Success)
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FIELD_BUTTON_IDS.sqlSelect)
      .setLabel('Selecionar tabela')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3, row4];
};

const getState = (userId) => {
  if (!userPanels.has(userId)) {
    userPanels.set(userId, defaultPanel1State());
  }
  return userPanels.get(userId);
};

const fieldModalConfig = {
  title: { id: MODAL_IDS.title, label: 'Título da embed', style: TextInputStyle.Short, placeholder: 'Ex.: Lançamento da semana' },
  description: { id: MODAL_IDS.description, label: 'Descrição da embed', style: TextInputStyle.Paragraph, placeholder: 'Fale sobre o painel' },
  color: { id: MODAL_IDS.color, label: 'Cor (hex)', style: TextInputStyle.Short, placeholder: '#00a65a' },
  price: { id: MODAL_IDS.price, label: 'Preço do produto', style: TextInputStyle.Short, placeholder: '99.90' },
  stock: { id: MODAL_IDS.stock, label: 'Estoque disponível', style: TextInputStyle.Short, placeholder: '12' },
  name: { id: MODAL_IDS.name, label: 'Nome do produto', style: TextInputStyle.Short, placeholder: 'Tênis Classic' },
  sql: { id: MODAL_IDS.sql, label: 'Nome da tabela SQL', style: TextInputStyle.Short, placeholder: 'produtos_lancamento' },
  cart: { id: 'painel1-modal-cart', label: 'Quantidade do carrinho', style: TextInputStyle.Short, placeholder: '1' },
  coupon: { id: MODAL_IDS.coupon, label: 'Código do cupom', style: TextInputStyle.Short, placeholder: 'VGN10' }
};

const buildModal = (field, state) => {
  const config = fieldModalConfig[field];
  if (!config) return null;
  const modal = new ModalBuilder().setCustomId(config.id).setTitle(config.label);
  const input = new TextInputBuilder()
    .setCustomId(field)
    .setLabel(config.label)
    .setStyle(config.style)
    .setPlaceholder(config.placeholder)
    .setRequired(true);

  if (field === 'cart' && state.cartQuantity !== undefined) {
    input.setValue(state.cartQuantity.toString());
  } else if (field === 'coupon' && state.appliedCoupon?.code) {
    input.setValue(state.appliedCoupon.code);
  } else if (state[field]) {
    input.setValue(state[field].toString());
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
};

const updatePanelMessage = async (interaction, state) => {
  if (!state.panelMessageId) return;
  try {
    const message = await interaction.channel.messages.fetch(state.panelMessageId);
    await message.edit({
      embeds: [buildPanel1Embed(state)],
      components: buildPanel1Buttons()
    });
  } catch (error) {
    console.error('Não foi possível atualizar o painel após modal:', error);
  }
};

const handlePanel1Selection = async (interaction) => {
  const state = getState(interaction.user.id);
  await refreshStateFromDb(state);
  await interaction.update({
    embeds: [buildPanel1Embed(state)],
    components: buildPanel1Buttons()
  });
  if (interaction.message) {
    state.panelMessageId = interaction.message.id;
  }
};

const handlePanel2Selection = async (interaction) => {
  const painel2Embed = new EmbedBuilder()
    .setTitle('Painel 2')
    .setDescription('Este painel demonstra um menu secundário com opções de detalhe.')
    .setColor(0x00a65a);

  await interaction.update({
    embeds: [painel2Embed],
    components: [new ActionRowBuilder().addComponents(buildPanel2Menu())]
  });
};

const handleSqlTableSelect = async (interaction) => {
  const tableName = interaction.values[0];
  if (!tableName) {
    await interaction.update({
      content: 'Seleção inválida.',
      components: []
    });
    return;
  }
  const state = getState(interaction.user.id);
  state.sqlTable = tableName;
  await refreshStateFromDb(state);
  await updatePanelMessage(interaction, state);
  await interaction.update({
    content: `Tabela **${tableName}** selecionada.`,
    components: []
  });
};

const handleSubMenu = async (interaction) => {
  const option = panel2MenuOptions.find((item) => item.value === interaction.values[0]);
  const detailEmbed = new EmbedBuilder()
    .setTitle(option ? `${option.label} selecionado` : 'Painel 2')
    .setDescription(option?.description || 'Seleção recebida.')
    .setColor(0x00a65a);

  await interaction.update({
    embeds: [detailEmbed],
    components: [new ActionRowBuilder().addComponents(buildPanel2Menu())]
  });
};

const handleFieldButton = async (interaction) => {
  const state = getState(interaction.user.id);
  switch (interaction.customId) {
    case FIELD_BUTTON_IDS.title:
      await interaction.showModal(buildModal('title', state));
      break;
    case FIELD_BUTTON_IDS.description:
      await interaction.showModal(buildModal('description', state));
      break;
    case FIELD_BUTTON_IDS.color:
      await interaction.showModal(buildModal('color', state));
      break;
    case FIELD_BUTTON_IDS.price:
      await interaction.showModal(buildModal('price', state));
      break;
    case FIELD_BUTTON_IDS.stock:
      await interaction.showModal(buildModal('stock', state));
      break;
    case FIELD_BUTTON_IDS.name:
      await interaction.showModal(buildModal('name', state));
      break;
    case FIELD_BUTTON_IDS.sql:
      await interaction.showModal(buildModal('sql', state));
      break;
    case FIELD_BUTTON_IDS.sqlSelect: {
      const row = await buildSqlTableMenuRow();
      if (!row) {
      await interaction.reply({
        content: 'Não há tabelas existentes para selecionar. Use o botão SQL para informar o nome manualmente.',
        flags: MessageFlags.Ephemeral
      });
        return;
      }
      await interaction.reply({
        content: 'Selecione a tabela que deseja reutilizar no painel.',
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      break;
    }
    case FIELD_BUTTON_IDS.image: {
      await interaction.reply({
        content: 'Envie uma imagem como anexo neste canal. Eu vou salvar o primeiro arquivo que você enviar nos próximos 60 segundos.',
        flags: MessageFlags.Ephemeral
      });
      try {
        const filter = (message) => message.author.id === interaction.user.id && message.attachments.size > 0;
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const attachment = collected.first().attachments.first();
        state.image = attachment.url;
        await interaction.followUp({ content: 'Imagem registrada com sucesso.', flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.followUp({ content: 'Nenhuma imagem foi enviada a tempo.', flags: MessageFlags.Ephemeral });
      }
      break;
    }
    case FIELD_BUTTON_IDS.send:
      await handleSendPanel(interaction);
      break;
  }
};

const handleModalSubmit = async (interaction) => {
  const state = getState(interaction.user.id);
  const field = interaction.customId.replace('painel1-modal-', '');
  const value = interaction.fields.getTextInputValue(field);
  switch (field) {
    case 'title':
    case 'description':
    case 'name':
      state[field] = value;
      break;
    case 'color':
      state.color = normalizeColor(value) || state.color;
      break;
    case 'price':
      state.price = formatPrice(value);
      break;
    case 'stock':
      state.stock = getStockValue(value);
      break;
    case 'sql':
      state.sqlTable = value.trim() || state.sqlTable;
      break;
    case 'cart': {
      await refreshStateFromDb(state);
      const quantity = Math.floor(Number(value));
      if (Number.isNaN(quantity) || quantity < 1) {
        await interaction.reply({
          content: 'Informe uma quantidade válida (mínimo 1).',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const available = state.stock ?? 0;
      if (quantity > available) {
        await interaction.reply({
          content: `Só há ${available} unidade${available === 1 ? '' : 's'} em estoque.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      state.cartQuantity = quantity;
      await interaction.reply({
        content: `Quantidade ajustada para ${quantity}.`,
        flags: MessageFlags.Ephemeral
      });
      await updateCartMessage(state, interaction.client);
      return;
    }
    case 'coupon': {
      await refreshStateFromDb(state);
      const code = value.trim().toUpperCase();
      if (!code.length) {
        await interaction.reply({
          content: 'Informe um código de cupom válido.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const coupon = await getCouponByCode(code);
      if (!coupon) {
        await interaction.reply({
          content: `Cupom **${code}** inválido.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const discount = Number(coupon.desconto);
      if (Number.isNaN(discount) || discount <= 0 || discount > 100) {
        await interaction.reply({
          content: 'Este cupom não oferece um desconto válido.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const basePrice = formatPrice(state.price);
      if (basePrice === null) {
        await interaction.reply({
          content: 'É preciso ter um preço definido no painel antes de aplicar o cupom.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      state.appliedCoupon = { code: coupon.codigo.toUpperCase(), discount };
      await interaction.reply({
        content: `Cupom **${coupon.codigo}** aplicado (${discount.toFixed(2)}% off).`,
        flags: MessageFlags.Ephemeral
      });
      await updateCartMessage(state, interaction.client);
      return;
    }
    default:
      break;
  }
  const label = field === 'cart' ? 'Quantidade do carrinho' : `${field.charAt(0).toUpperCase() + field.slice(1)}`;
  await interaction.reply({ content: `${label} atualizado.`, flags: MessageFlags.Ephemeral });
  await refreshStateFromDb(state);
  await updatePanelMessage(interaction, state);
};

const handleSendPanel = async (interaction) => {
  const state = getState(interaction.user.id);
  const priceValue = formatPrice(state.price);
  const stockValue = getStockValue(state.stock);

  if (!state.name || priceValue === null || stockValue === null || !state.sqlTable) {
      await interaction.reply({
        content: 'Preencha nome, preço, estoque e o nome da tabela SQL antes de enviar o painel.',
        flags: MessageFlags.Ephemeral
      });
    return;
  }

  try {
    const tableName = await ensureTable(state.sqlTable);
    state.sqlTable = tableName;
    const meta = await ensureMetaRow(tableName, state.name, priceValue);
    state.productId = meta.id;
    const cleanName = stripMetaName(meta.nome);
    if (cleanName) {
      state.name = cleanName;
    }
    await refreshStateFromDb(state);
  } catch (error) {
    console.error('Erro ao salvar no banco:', error);
  }

  const embed = buildPublishedEmbed(state);

  if (interaction.channel) {
    const buyButton = new ButtonBuilder()
      .setCustomId(BUY_BUTTON_ID)
      .setLabel('Comprar')
      .setEmoji('1490077438867411048')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(buyButton);
    const publishedMessage = await interaction.channel.send({ embeds: [embed], components: [row] });
    registerPublishedPanel(state.sqlTable, publishedMessage.id, interaction.channel.id, buildSnapshotFromState(state));
  }

  await interaction.reply({ content: 'Painel enviado com sucesso.', flags: MessageFlags.Ephemeral });
};

const sanitizeChannelName = (value) => {
  if (!value) return `painel-${Date.now()}`;
  return `painel-${value}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const handleBuyButton = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: 'Esse botão só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  const userChannelName = sanitizeChannelName(`${interaction.user.username}-${Date.now()}`);
  const botId = interaction.client.user?.id;

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

  if (botId) {
    overwrites.push({
      id: botId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const state = getState(interaction.user.id);
  await refreshStateFromDb(state);
  const stockValue = getStockValue(state.stock);
  if (stockValue === 0) {
      await interaction.reply({
        content: `Não há estoque disponível para ${state.name || 'este produto'}.`,
        flags: MessageFlags.Ephemeral
      });
    return;
  }

  try {
    const channel = await guild.channels.create({
      name: userChannelName,
      type: ChannelType.GuildText,
      parent: BUY_CHANNEL_CATEGORY,
      permissionOverwrites: overwrites,
      reason: 'Solicitado pelo botão Comprar'
    });

    const cartEmbed = buildCartEmbed(state);
    const publishedRow = buildPublishedButtons();
    const publishedMessage = await channel.send({ embeds: [cartEmbed], components: [publishedRow] });
    state.cartChannelId = channel.id;
    state.cartMessageId = publishedMessage.id;
    state.cartQuantity = state.cartQuantity || 1;

    await interaction.reply({
      content: `Criei o canal ${channel} apenas para você.`,
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('Erro ao criar canal privado do botão Comprar:', error);
    await interaction.reply({ content: 'Não consegui criar o canal privado.', flags: MessageFlags.Ephemeral });
  }
};

const handlePublishedButton = async (interaction) => {
  const button = PUBLISHED_BUTTONS.find((item) => item.id === interaction.customId);
  if (!button) return;

  if (interaction.customId === 'painel1-edit-quantity') {
    const state = getState(interaction.user.id);
    await refreshStateFromDb(state);
    await interaction.showModal(buildModal('cart', state));
    return;
  }

  if (interaction.customId === 'painel1-use-coupon') {
    const state = getState(interaction.user.id);
    await refreshStateFromDb(state);
    await interaction.showModal(buildModal('coupon', state));
    return;
  }

  if (interaction.customId === 'painel1-cancel') {
    const state = getState(interaction.user.id);
    state.appliedCoupon = null;
    state.cartChannelId = null;
    state.cartMessageId = null;
    await interaction.reply({ content: 'Este canal será removido em 5 segundos.', flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    setTimeout(async () => {
      try {
        if (channel && !channel.deleted) {
          await channel.delete('Canal cancelado pelo botão Cancelar');
        }
      } catch (error) {
        console.error('Não foi possível deletar o canal cancelado:', error);
      }
    }, 5000);
    return;
  }

  await interaction.reply({
    content: `Botão "${button.label}" acionado. Ainda não há ações específicas implementadas.`,
    flags: MessageFlags.Ephemeral
  });
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Mostra um painel interativo com opções para Painel 1 e Painel 2.'),
  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(buildMainMenu());
    await interaction.reply({
      embeds: [painelEmbed],
      components: [row]
    });
  },
  menuId: PANEL_MENU_ID,
  panel2MenuId: PANEL2_MENU_ID,
  sqlTableMenuId: SQL_TABLE_MENU_ID,
  panel1FieldButtons: Object.values(FIELD_BUTTON_IDS),
  buyButtonId: BUY_BUTTON_ID,
  publishedButtonIds: PUBLISHED_BUTTON_IDS,
  handleSelect: async (interaction) => {
    if (interaction.values[0] === 'painel1') {
      await handlePanel1Selection(interaction);
      return;
    }
    await handlePanel2Selection(interaction);
  },
  handlePanel2Menu: handleSubMenu,
  handleSqlTableSelect,
  handleFieldButton,
  handleModalSubmit,
  handleBuyButton,
  handlePublishedButton,
  refreshPublishedPanel
};


