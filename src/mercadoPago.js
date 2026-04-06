const { randomUUID } = require('node:crypto');
const { EmbedBuilder } = require('discord.js');
const {
  insertPixOrder,
  updatePixOrderStatus,
  listPendingPixOrders,
  reserveProductKeys
} = require('./database');

const PIX_PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const PIX_PAYER_EMAIL = process.env.MERCADO_PAGO_PIX_PAYER_EMAIL || 'pagamentos@vgn.app';
const MONITOR_INTERVAL_MS = Number(process.env.MERCADO_PAGO_MONITOR_INTERVAL_MS) || 30_000;
const WEBHOOK_URL = process.env.MERCADO_PAGO_WEBHOOK_URL || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const PURCHASE_ROLE_ID = process.env.MERCADO_PAGO_PURCHASE_ROLE_ID || '1486372271160557678';
const PAYMENT_CHANNEL_ID = process.env.MERCADO_PAGO_NOTIFICATION_CHANNEL_ID || '1487287630797209661';

const normalizeAmount = (value) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) {
    throw new Error('O valor total precisa ser numérico.');
  }
  return num;
};

const buildPixPayload = ({ totalAmount, quantity, description, externalReference, payerEmail }) => ({
  transaction_amount: normalizeAmount(totalAmount),
  payment_method_id: 'pix',
  description: description || 'Pagamento',
  external_reference: externalReference || randomUUID(),
  payer: {
    email: payerEmail || PIX_PAYER_EMAIL
  },
  additional_info: {
    items: [
      {
        title: description || 'Produto',
        quantity: Number(quantity) || 1,
        unit_price: normalizeAmount(totalAmount)
      }
    ]
  }
});

const createPixPayment = async ({ totalAmount, quantity = 1, description, externalReference, payerEmail, idempotencyKey }) => {
  if (!ACCESS_TOKEN) {
    throw new Error('Informe MERCADO_PAGO_ACCESS_TOKEN no .env para gerar pagamentos Pix.');
  }

  const payload = buildPixPayload({ totalAmount, quantity, description, externalReference, payerEmail });
  const response = await fetch(PIX_PAYMENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey || randomUUID()
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `${data?.message || 'Falha ao criar o pagamento Pix no Mercado Pago.'} ${JSON.stringify(data?.cause || data?.errors || [])}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  const transactionData = data?.point_of_interaction?.transaction_data;
  const qrCode = transactionData?.qr_code;
  if (!qrCode) {
    const err = new Error('A resposta do Pix não retornou o código QR.');
    err.data = data;
    throw err;
  }

  return {
    paymentId: data.id,
    qrCode,
    qrCodeBase64: transactionData?.qr_code_base64,
    ticketUrl: transactionData?.ticket_url,
    raw: data
  };
};

const buildCurrency = (value) => `R$${Number(value).toFixed(2).replace('.', ',')}`;

const sendPixWebhook = async (payload) => {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Falha ao notificar webhook externo do Mercado Pago:', error);
  }
};

const normalizePaymentId = (paymentId) => String(paymentId).replace(/\\.0$/, '');

const fetchPaymentStatus = async (paymentId) => {
  if (!ACCESS_TOKEN) {
    throw new Error('Token do Mercado Pago ausente para verificar pagamentos.');
  }
  const normalizedId = normalizePaymentId(paymentId);
  const response = await fetch(`${PIX_PAYMENTS_URL}/${normalizedId}`, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    if (response.status === 404) {
      console.warn(`Pagamento Pix ${paymentId} não encontrado (404).`);
      return null;
    }
    throw new Error(`Erro ao consultar pagamento Pix ${paymentId}: ${response.status}`);
  }
  return response.json();
};

let monitorHandle = null;

const processPendingPayments = async (client) => {
  try {
    const orders = await listPendingPixOrders();
    for (const order of orders) {
      try {
        const payment = await fetchPaymentStatus(order.payment_id);
        if (!payment) {
          continue;
        }
        if (payment.status === 'approved') {
          await handleApprovedOrder(order, payment, client);
        } else if (['cancelled', 'rejected'].includes(payment.status)) {
          await updatePixOrderStatus(order.payment_id, 'failed');
        }
      } catch (error) {
        console.error('Erro ao verificar pagamento Pix pendente:', error);
      }
    }
  } catch (error) {
    console.error('Erro ao listar pagamentos Pix pendentes:', error);
  }
};

const sendPurchaseEmbed = async (user, order, keys) => {
  const amountText = buildCurrency(order.total_amount);
  const productLine =
    Number(order.quantity) > 1 ? `${order.quantity}x ${order.product_name}` : order.product_name;
  const embed = new EmbedBuilder()
    .setTitle('VgN | Compra Aprovada')
    .setDescription(
      [
        '💸 | **TOTAL PAGO:**',
        amountText,
        '',
        '🛒 | **PRODUTOS:**',
        productLine,
        '',
        '✏️ | **Quantidade**',
        `${order.quantity}`,
        '',
        '🗓️ | **Data:**',
        new Date(order.created_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      ].join('\n')
    );
  const keysMessage = keys.length ? keys.map((key) => `\`${key}\``).join('\n') : '``Sem chaves disponíveis``';
  try {
    await user.send({ embeds: [embed] });
    await user.send(keysMessage);
  } catch (error) {
    console.error('Não consegui enviar DM ao usuário após aprovação do pagamento:', error);
  }
};

const assignPurchaseRole = async (client, userId) => {
  if (!GUILD_ID || !PURCHASE_ROLE_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.roles.add(PURCHASE_ROLE_ID).catch((error) => {
        console.error('Erro ao adicionar cargo ao usuário:', error);
      });
    }
  } catch (error) {
    console.error('Erro ao buscar guilda/usuário para atribuir cargo:', error);
  }
};

const PAYMENT_APPROVED_IMAGE_URL =
  'https://cdn.discordapp.com/attachments/977131879629197372/1490490900198199521/aprovedd.png';

const buildChannelEmbed = (user, order, payment, keys) => {
  const amountText = buildCurrency(order.total_amount);
  const productLine =
    Number(order.quantity) > 1 ? `${order.quantity}x ${order.product_name}` : order.product_name;
  const dateValue = payment.date_approved || payment.date_created || new Date().toISOString();
  const formattedDate = new Date(dateValue).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return new EmbedBuilder()
    .setTitle('Pagamento Aprovado')
    .setColor(0x00a65a)
    .setImage(PAYMENT_APPROVED_IMAGE_URL)
    .setDescription(
      [
        `👤 | Cliente:\n<@${user.id}>`,
        `🛒 | Produto:\n${productLine}`,
        `💸 | Valor total:\n${amountText}`,
        `🗓️ | Data:\n${formattedDate}`
      ].join('\n')
    );
};

const sendChannelNotification = async (client, user, order, payment) => {
  if (!PAYMENT_CHANNEL_ID) return;
  const channel = await client.channels.fetch(PAYMENT_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const embed = buildChannelEmbed(user, order, payment);
  await channel.send({ embeds: [embed] });
};

const handleApprovedOrder = async (order, payment, client) => {
  const usePanel2 = order.panel === 'painel2';
  let keys = [];
  try {
    keys = await reserveProductKeys(order.table_name, Number(order.quantity), usePanel2);
  } catch (error) {
    console.error('Não consegui reservar keys após pagamento aprovado:', error);
    await updatePixOrderStatus(order.payment_id, 'failed');
    return;
  }
  await updatePixOrderStatus(order.payment_id, 'approved', { keys });
  await assignPurchaseRole(client, order.user_id);
  const user = await client.users.fetch(order.user_id).catch(() => null);
  if (user) {
    await sendPurchaseEmbed(user, order, keys);
    await sendChannelNotification(client, user, order, payment);
  }
  const painelCommand = client.commands.get('painel');
  if (painelCommand?.refreshPublishedPanel) {
    await painelCommand.refreshPublishedPanel(client, order.table_name);
  }
  if (painelCommand?.refreshPublishedPanel2) {
    await painelCommand.refreshPublishedPanel2(client, order.table_name);
  }
};

const startPixMonitor = (client) => {
  if (monitorHandle) return;
  const tick = async () => {
    await processPendingPayments(client);
    monitorHandle = setTimeout(tick, MONITOR_INTERVAL_MS);
  };
  tick();
};

module.exports = {
  createPixPayment,
  QR_IMAGE_URL: (qrData) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrData)}`,
      sendPixWebhook,
  startPixMonitor
};
