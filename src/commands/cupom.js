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
  MessageFlags
} = require('discord.js');
const { addCoupon, listCoupons, deleteCoupon } = require('../database');

const BUTTON_IDS = {
  create: 'cupom-create',
  delete: 'cupom-delete'
};

const MODAL_IDS = {
  create: 'cupom-modal-create'
};

const SELECT_ID = 'cupom-delete-menu';

const buildEmbed = () =>
  new EmbedBuilder()
    .setTitle('Gestão de cupons')
    .setDescription('Crie e exclua cupons de desconto para os clientes. Use os botões abaixo.')
    .setColor(0x00a65a);

const buildButtonRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_IDS.create).setLabel('Criar cupom').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BUTTON_IDS.delete).setLabel('Deletar cupom').setStyle(ButtonStyle.Danger)
  );

const buildCreateModal = () => {
  const modal = new ModalBuilder().setCustomId(MODAL_IDS.create).setTitle('Criar cupom');
  const code = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('Código do cupom')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('EXEMPLO10')
    .setRequired(true);
  const discount = new TextInputBuilder()
    .setCustomId('discount')
    .setLabel('Desconto (%)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('15')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(code), new ActionRowBuilder().addComponents(discount));
  return modal;
};

const buildDeleteMenu = async () => {
  const coupons = await listCoupons();
  if (!coupons.length) return null;
  const options = coupons.slice(0, 25).map((coupon) => ({
    label: coupon.codigo,
    value: coupon.codigo,
    description: `Desconto de ${Number(coupon.desconto).toFixed(2)}%`
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_ID)
      .setPlaceholder('Selecione o cupom para deletar')
      .addOptions(options)
  );
};

const execute = async (interaction) => {
  await interaction.reply({
    embeds: [buildEmbed()],
    components: [buildButtonRow()]
  });
};

const handleButton = async (interaction) => {
  if (interaction.customId === BUTTON_IDS.create) {
    await interaction.showModal(buildCreateModal());
    return;
  }
  if (interaction.customId === BUTTON_IDS.delete) {
    const row = await buildDeleteMenu();
    if (!row) {
      await interaction.reply({
        content: 'Nenhum cupom cadastrado para deletar.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    await interaction.reply({
      content: 'Selecione o cupom que deseja remover.',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
    return;
  }
};

const handleModalSubmit = async (interaction) => {
  const code = interaction.fields.getTextInputValue('code').trim();
  const discountRaw = interaction.fields.getTextInputValue('discount').trim().replace(',', '.');
  const discount = Number(discountRaw);
  if (!code.length || Number.isNaN(discount) || discount <= 0 || discount > 100) {
    await interaction.reply({
      content: 'Informe um código válido e um desconto entre 1% e 100%.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  await addCoupon(code.toUpperCase(), Number(discount.toFixed(2)));
  await interaction.reply({
    content: `Cupom **${code.toUpperCase()}** cadastrado com ${discount.toFixed(2)}% de desconto.`,
    flags: MessageFlags.Ephemeral
  });
};

const handleSelect = async (interaction) => {
  const code = interaction.values[0];
  if (!code) {
    await interaction.reply({ content: 'Seleção inválida.', flags: MessageFlags.Ephemeral });
    return;
  }
  const deleted = await deleteCoupon(code);
  if (!deleted) {
    await interaction.reply({
      content: `Não consegui remover o cupom ${code}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  await interaction.update({
    content: `Cupom **${code}** removido.`,
    components: [],
    embeds: []
  });
};

module.exports = {
  data: new SlashCommandBuilder().setName('cupom').setDescription('Gerencia os cupons de desconto.'),
  execute,
  buttonIds: Object.values(BUTTON_IDS),
  modalIds: Object.values(MODAL_IDS),
  selectId: SELECT_ID,
  handleButton,
  handleModalSubmit,
  handleSelect
};
