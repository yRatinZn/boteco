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
  MessageFlags
} = require('discord.js');
const {
  getProductList,
  getPanel2ProductList,
  getProductById,
  getPanel2ProductById,
  getProductMetadata,
  getPanel2ProductMetadata,
  updateProduct,
  updateProductPanel2,
  addProductKeys,
  addProductKeysPanel2,
  ensureMetaRow,
  ensurePanel2MetaRow,
  countStockRows,
  countPanel2StockRows
} = require('../database');

const MENU_ID = 'estoque-menu';
const BUTTON_IDS = {
  stock: 'estoque-add',
  price: 'estoque-price'
};
const MODAL_IDS = {
  stock: 'estoque-modal-stock',
  price: 'estoque-modal-price'
};
const INPUT_FIELD_ID = 'value';
const MAX_OPTIONS = 25;

const userSelections = new Map();

const stripMetaName = (value) => {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith('__meta__')) {
    return value.slice('__meta__'.length);
  }
  return value;
};

const buildMenuEmbed = () =>
  new EmbedBuilder()
    .setTitle('Painel de Estoque')
    .setDescription('Selecione um produto no menu abaixo para conferir estoque ou atualizar preço e keys.')
    .setColor(0x00a65a);

const buildProductEmbed = (product, tableName, stock) => {
  const name = stripMetaName(product.nome) || `Produto (${tableName})`;
  const priceText =
    product.preco === null || product.preco === undefined
      ? 'Não informado'
      : `R$${Number(product.preco).toFixed(2).replace('.', ',')}`;
  const stockText = `${stock ?? 0}`;
  return new EmbedBuilder()
    .setTitle(name)
    .setDescription(`Tabela: ${tableName}`)
    .addFields([
      { name: 'Preço atual', value: priceText, inline: true },
      { name: 'Estoque atual', value: stockText, inline: true }
    ])
    .setFooter({ text: `ID ${product.id}` })
    .setColor(0x00a65a);
};

const buildMenuRow = (options) =>
  new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MENU_ID)
      .setPlaceholder(options.length ? 'Escolha um produto...' : 'Nenhum produto cadastrado')
      .addOptions(options)
  );

const buildProductButtons = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.stock)
      .setLabel('Adicionar estoque')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.price)
      .setLabel('Alterar preço')
      .setStyle(ButtonStyle.Secondary)
  );

const normalizeOptionValue = (product, isPanel2) => {
  const prefix = isPanel2 ? 'panel2:' : '';
  return `${prefix}${product.table}|${product.id}`;
};

const buildOptions = async () => {
  const [mainProducts, panel2Products] = await Promise.all([getProductList(), getPanel2ProductList()]);
  const allProducts = [
    ...mainProducts.map((product) => ({ product, isPanel2: false })),
    ...panel2Products.map((product) => ({ product, isPanel2: true }))
  ];
  return allProducts
    .slice(0, MAX_OPTIONS)
    .map(({ product, isPanel2 }) => ({
      label: product.name,
      description: `${product.stock} em estoque | R$${Number(product.price ?? 0).toFixed(2).replace('.', ',')}`,
      value: normalizeOptionValue(product, isPanel2)
    }));
};

const parseSelectionValue = (value) => {
  const prefix = 'panel2:';
  const isPanel2 = value.startsWith(prefix);
  const normalized = isPanel2 ? value.slice(prefix.length) : value;
  const [table, idString] = normalized.split('|');
  return { table, id: Number(idString), isPanel2 };
};

const notifyPainel = async (interaction, table) => {
  const painelCmd = interaction.client.commands.get('painel');
  if (!painelCmd) return;
  if (painelCmd.refreshPublishedPanel) {
    await painelCmd.refreshPublishedPanel(interaction.client, table).catch(() => null);
  }
  if (painelCmd.refreshPublishedPanel2) {
    await painelCmd.refreshPublishedPanel2(interaction.client, table).catch(() => null);
  }
};

const buildModal = (type) => {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_IDS[type])
    .setTitle(type === 'stock' ? 'Adicionar estoque' : 'Alterar preço');
  const input = new TextInputBuilder()
    .setCustomId(INPUT_FIELD_ID)
    .setLabel(type === 'stock' ? 'Informe cada key por linha' : 'Informe o novo preço')
    .setPlaceholder(type === 'stock' ? 'key1\nkey2\n...' : '19.90')
    .setStyle(type === 'stock' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
};

const execute = async (interaction) => {
  const options = await buildOptions();
  const embed = buildMenuEmbed();
  if (!options.length) {
    await interaction.reply({
      embeds: [embed.setDescription('Nenhum produto cadastrado no banco.')],
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  await interaction.reply({
    embeds: [embed],
    components: [buildMenuRow(options)],
    flags: MessageFlags.Ephemeral
  });
};

const handleMenuSelect = async (interaction) => {
  const selection = parseSelectionValue(interaction.values[0]);
  const metadataResult = selection.isPanel2
    ? await getPanel2ProductMetadata(selection.table)
    : await getProductMetadata(selection.table);
  if (!metadataResult?.row) {
    await interaction.reply({ content: 'Produto não encontrado.', flags: MessageFlags.Ephemeral });
    return;
  }
  const product = metadataResult.row;
  const stock = metadataResult.stock ?? 0;
  userSelections.set(interaction.user.id, {
    ...selection,
    messageId: interaction.message.id,
    channelId: interaction.channelId,
    isMeta: metadataResult.isMeta
  });
  await interaction.update({
    embeds: [buildProductEmbed(product, selection.table, stock)],
    components: [buildProductButtons()]
  });
};

const showModal = (interaction, type) => interaction.showModal(buildModal(type));

const handleButton = async (interaction) => {
  if (interaction.customId === BUTTON_IDS.stock) {
    return showModal(interaction, 'stock');
  }
  if (interaction.customId === BUTTON_IDS.price) {
    return showModal(interaction, 'price');
  }
};

const refreshProductMessage = async (interaction, selection) => {
  if (!selection?.messageId || !selection.channelId) return;
  const channel = await interaction.client.channels.fetch(selection.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const message = await channel.messages.fetch(selection.messageId).catch(() => null);
  if (!message) {
    userSelections.delete(interaction.user.id);
    return;
  }
  const getProduct = selection.isPanel2 ? getPanel2ProductById : getProductById;
  const product = await getProduct(selection.table, selection.id).catch(() => null);
  if (!product) {
    userSelections.delete(interaction.user.id);
    return;
  }
  const rowIsMeta = typeof product.nome === 'string' && product.nome.startsWith('__meta__');
  const stock = rowIsMeta
    ? selection.isPanel2
      ? await countPanel2StockRows(selection.table).catch(() => 0)
      : await countStockRows(selection.table).catch(() => 0)
    : Math.max(product.estoque ?? 0, 0);
  try {
    await message.edit({
      embeds: [buildProductEmbed(product, selection.table, stock)],
      components: [buildProductButtons()]
    });
  } catch (error) {
    if (error?.code === 10008) {
      // mensagem foi removida; não tentamos atualizar novamente
      userSelections.delete(interaction.user.id);
      return;
    }
    console.error('Não consegui atualizar a mensagem do estoque:', error);
  }
};

const handleModalSubmit = async (interaction) => {
  const selection = userSelections.get(interaction.user.id);
  if (!selection) {
    await interaction.reply({ content: 'Selecione um produto antes de atualizar.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === MODAL_IDS.stock) {
    const raw = interaction.fields.getTextInputValue(INPUT_FIELD_ID);
    const keys = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!keys.length) {
      await interaction.reply({ content: 'Informe ao menos uma key por linha.', flags: MessageFlags.Ephemeral });
      return;
    }
    const getProduct = selection.isPanel2 ? getPanel2ProductById : getProductById;
    const addKeys = selection.isPanel2 ? addProductKeysPanel2 : addProductKeys;
    const ensureMeta = selection.isPanel2 ? ensurePanel2MetaRow : ensureMetaRow;
    const product = await getProduct(selection.table, selection.id).catch(() => null);
    const price = product?.preco ?? 0;
    await addKeys(selection.table, keys, price);
    if (!selection.isMeta) {
      const productName = stripMetaName(product?.nome) || selection.table;
      const meta = await ensureMeta(selection.table, productName, price);
      selection.id = meta.id;
      selection.isMeta = true;
      userSelections.set(interaction.user.id, selection);
    }
    // After ensuring meta row, stock will be based on key count inside refresh.
    await interaction.reply({ content: 'Keys adicionadas e estoque atualizado.', flags: MessageFlags.Ephemeral });
    await refreshProductMessage(interaction, selection);
    await notifyPainel(interaction, selection.table);
    return;
  }
    if (interaction.customId === MODAL_IDS.price) {
      const raw = interaction.fields.getTextInputValue(INPUT_FIELD_ID);
    const parsed = Number(raw.replace(',', '.'));
    if (Number.isNaN(parsed)) {
      await interaction.reply({ content: 'Preço inválido.', flags: MessageFlags.Ephemeral });
      return;
    }
      const getProduct = selection.isPanel2 ? getPanel2ProductById : getProductById;
      const ensureMeta = selection.isPanel2 ? ensurePanel2MetaRow : ensureMetaRow;
      const updatePrice = selection.isPanel2 ? updateProductPanel2 : updateProduct;
      const product = await getProduct(selection.table, selection.id).catch(() => null);
      if (!selection.isMeta) {
        const productName = stripMetaName(product?.nome) || selection.table;
        const meta = await ensureMeta(selection.table, productName, Number(parsed.toFixed(2)));
        selection.id = meta.id;
        selection.isMeta = true;
        userSelections.set(interaction.user.id, selection);
      }
      await updatePrice(selection.table, { id: selection.id, preco: Number(parsed.toFixed(2)) });
    await interaction.reply({ content: 'Preço atualizado.', flags: MessageFlags.Ephemeral });
    await refreshProductMessage(interaction, selection);
    await notifyPainel(interaction, selection.table);
  }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('estoque')
    .setDescription('Visualize e atualize o estoque dos produtos já cadastrados.'),
  execute,
  menuId: MENU_ID,
  buttonIds: Object.values(BUTTON_IDS),
  modalIds: Object.values(MODAL_IDS),
  handleMenuSelect,
  handleButton,
  handleModalSubmit
};
