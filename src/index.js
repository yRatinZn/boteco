const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
require('dotenv').config();

const PREFIX = process.env.COMMAND_PREFIX?.trim() || '.';
const token = process.env.DISCORD_TOKEN;
const COMMAND_ROLE_ID = '1485015881657483264';
const SUPPORT_ROLE_ID = '1484999934934519970';
const SUPPORT_ROLE_ID_2 = '1486463263523995742';
const CLOSE_ROLE_IDS = ['977033993197346857', '1486463263523995742'];
const TICKET_CATEGORY_ID = '1486462584835280897';
const ORDER_CATEGORY_ID = '1486534097391059046';
const WEBHOOKS = {
  open: 'https://discordapp.com/api/webhooks/1486465765191450634/yK08d-aU4a_5s8Ralpk3uriJzwlqTUte34WlNuA5hmvvnehTabeLTSwzGUEe9M3fRgzC',
  close: 'https://discordapp.com/api/webhooks/1486465846233661630/oVUAvt8O2kmlEUvtj8VJEidgfoqz45JJvzt1QS-oNIRDUI5cOWdGwaU2GQgcocLCRTSo',
  delete: 'https://discordapp.com/api/webhooks/1486466618182864986/bBVq_YhFT7sO7E5HS13FTMa3f7iJbbQKyH_U-3hRA9KjAGl1OhiKF9-U_6crUSCBq5_V',
  orderCreate: 'https://discordapp.com/api/webhooks/1487186665825894401/aTqll9VEaH0KRH7IeVLriCemDJWOrnv0OSM7ti5BRDTbrwG7xlQeP91HGu-LW_zoof9D',
  orderDelete: 'https://discordapp.com/api/webhooks/1487186566194659532/QfGKIT4PXXp7ydjgYHyYptKfyat5MTJugjgBVGqXuJWvWAEpbuX9wKpX6-t-y8Xw_lno',
  saleConfirm: 'https://discordapp.com/api/webhooks/1487186523680936016/gpaPeX7fW-JNF6KO2kwb0fpvvv2A7s3H2ZB1D9BQhDWkvtMT3gIGweNbp6059gYwpOQu'
};
const DEFAULT_HELP_COMMANDS = ['help', 'ticket', 'vendamenu', 'vendabotao', 'listar', 'addestoque'];
const HELP_COMMAND_NAMES =
  process.env.HELP_COMMANDS ? process.env.HELP_COMMANDS.split(',').map((nome) => nome.trim()).filter(Boolean) : DEFAULT_HELP_COMMANDS;
const WEBHOOK_PORT = Number(process.env.PORT || process.env.WEBHOOK_PORT) || 3000;
const PAYMENT_CONFIRMATION_WEBHOOK_URL =
  process.env.PAYMENT_CONFIRMATION_WEBHOOK_URL?.trim() || 'https://vgn-i7v4.onrender.com/mercadopago/webhook';
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
const MERCADO_PAGO_PAYER_DOMAIN = process.env.MERCADO_PAGO_PAYER_DOMAIN?.trim() || 'pix.vg';
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1/payments';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'produtos.db');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (error) => {
  if (error) {
    console.error('Falha ao abrir o banco de dados produtos:', error);
    process.exit(1);
  }
});

db.configure('busyTimeout', 5000);

const sanitizeTableName = (value = '') =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const ensureItemColumn = (tableName) =>
  new Promise((resolve, reject) => {
    const infoSql = `PRAGMA table_info("${tableName}")`;
    db.all(infoSql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      const hasItem = rows.some((row) => row.name === 'item');
      if (hasItem) {
        resolve();
        return;
      }
      db.run(`ALTER TABLE "${tableName}" ADD COLUMN item TEXT DEFAULT ''`, (alterError) => {
        if (alterError) {
          reject(alterError);
          return;
        }
        resolve();
      });
    });
  });

const ensureProductTable = (rawName) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(rawName);
    if (!tableName) {
      reject(new Error('Nome da tabela inválido.'));
      return;
    }

    const sql = `
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item TEXT DEFAULT '',
        stock INTEGER NOT NULL DEFAULT 0,
        price TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;

    db.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      ensureItemColumn(tableName)
        .then(() => resolve(tableName))
        .catch(reject);
    });
  });

const getProductTables = () =>
  new Promise((resolve, reject) => {
    const sql = `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `;
    db.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows.map((row) => row.name));
    });
  });

const getStockCount = (tableName) =>
  new Promise((resolve, reject) => {
    const sql = `SELECT COALESCE(SUM(stock), 0) AS total FROM "${tableName}"`;
    db.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row?.total || 0);
    });
  });

const addStockEntries = (tableName, items) =>
  new Promise((resolve, reject) => {
    if (!items.length) {
      resolve(0);
      return;
    }
    ensureItemColumn(tableName)
      .then(() => {
        const stmt = db.prepare(`INSERT INTO "${tableName}" (item, stock) VALUES (?, 1)`, (error) => {
          if (error) {
            reject(error);
            return;
          }
          let completed = 0;
          const runner = () => {
            if (completed >= items.length) {
              stmt.finalize((finalErr) => {
                if (finalErr) {
                  reject(finalErr);
                } else {
                  resolve(items.length);
                }
              });
              return;
            }
            stmt.run(items[completed], (runError) => {
              if (runError) {
                stmt.finalize(() => {
                  reject(runError);
                });
                return;
              }
              completed += 1;
              runner();
            });
          };
          runner();
        });
      })
      .catch(reject);
  });

const clearStockEntries = (tableName) =>
  new Promise((resolve, reject) => {
    db.run(`DELETE FROM "${tableName}"`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const dropStockTable = (tableName) =>
  new Promise((resolve, reject) => {
    db.run(`DROP TABLE IF EXISTS "${tableName}"`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const fetchStockRows = (tableName, limit) =>
  new Promise((resolve, reject) => {
    const sanitizedTable = sanitizeTableName(tableName);
    if (!sanitizedTable || limit <= 0) {
      resolve([]);
      return;
    }
    const sql = `SELECT id, item FROM "${sanitizedTable}" ORDER BY id ASC LIMIT ?`;
    db.all(sql, [limit], (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });

const deleteStockRows = (tableName, ids) =>
  new Promise((resolve, reject) => {
    if (!ids?.length) {
      resolve();
      return;
    }
    const sanitizedTable = sanitizeTableName(tableName);
    if (!sanitizedTable) {
      resolve();
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM "${sanitizedTable}" WHERE id IN (${placeholders})`;
    db.run(sql, ids, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const reserveStockItems = async (tableName, quantity) => {
  const sanitizedTable = sanitizeTableName(tableName);
  if (!sanitizedTable || quantity <= 0) {
    return { tableName: sanitizedTable, rows: [], ids: [] };
  }
  const rows = await fetchStockRows(sanitizedTable, quantity);
  if (!rows.length) {
    return { tableName: sanitizedTable, rows: [], ids: [] };
  }
  const ids = rows.map((row) => row.id);
  await deleteStockRows(sanitizedTable, ids);
  return { tableName: sanitizedTable, rows, ids };
};

const finalizeDeliveredProducts = async (tableName, ids) => {
  if (!tableName || !ids?.length) return;
  try {
    await deleteStockRows(tableName, ids);
  } catch (error) {
    console.error('Erro removendo produtos entregues do banco', error);
  }
};

const ensurePanelMetadataTable = () =>
  new Promise((resolve, reject) => {
    const sql = `
      CREATE TABLE IF NOT EXISTS panel_metadata (
        message_id TEXT PRIMARY KEY,
        channel_id TEXT,
        table_name TEXT NOT NULL,
        session TEXT DEFAULT '{}'
      )
    `;
    db.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const persistPanelMetadataEntry = (tableName, metadataEntry) =>
  new Promise((resolve, reject) => {
    if (!metadataEntry?.messageId) {
      resolve();
      return;
    }
    const sessionJson = JSON.stringify(metadataEntry.session || {});
    const sql = `
      INSERT INTO panel_metadata (message_id, channel_id, table_name, session)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        table_name = excluded.table_name,
        session = excluded.session
    `;
    db.run(sql, [metadataEntry.messageId, metadataEntry.channelId, tableName, sessionJson], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const deletePanelMetadataByMessage = (messageId) =>
  new Promise((resolve, reject) => {
    if (!messageId) {
      resolve();
      return;
    }
    db.run('DELETE FROM panel_metadata WHERE message_id = ?', [messageId], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const deletePanelMetadataByTable = (tableName) =>
  new Promise((resolve, reject) => {
    if (!tableName) {
      resolve();
      return;
    }
    db.run('DELETE FROM panel_metadata WHERE table_name = ?', [tableName], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const loadPanelMetadataFromDb = () =>
  new Promise((resolve, reject) => {
    db.all('SELECT message_id, channel_id, table_name, session FROM panel_metadata', (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      rows.forEach((row) => {
        if (!row?.message_id || !row.table_name) return;
        let sessionData = {};
        try {
          sessionData = JSON.parse(row.session || '{}');
        } catch {
          sessionData = {};
        }
        const metadataEntry = {
          channelId: row.channel_id,
          messageId: row.message_id,
          session: sessionData
        };
        const existing = panelMetadataByTable.get(row.table_name) || [];
        const filtered = existing.filter((item) => item.messageId !== row.message_id);
        filtered.push(metadataEntry);
        panelMetadataByTable.set(row.table_name, filtered);
        panelMetadataByMessageId.set(row.message_id, { tableName: row.table_name, entry: metadataEntry });
      });
      resolve();
    });
  });

const initPanelMetadataStorage = async () => {
  try {
    await ensurePanelMetadataTable();
    await loadPanelMetadataFromDb();
  } catch (error) {
    console.error('Erro ao carregar metadados de painel', error);
  }
};

initPanelMetadataStorage();

const getPriceForTable = (tableName) => {
  if (priceOverrides.has(tableName)) {
    return priceOverrides.get(tableName);
  }
  const metadataList = panelMetadataByTable.get(tableName);
  const metadata = metadataList?.[0];
  return metadata?.session.price || '';
};

const buildStockEmbed = (tableName, stock, price) =>
  new EmbedBuilder()
    .setTitle(`Estoque: ${tableName}`)
    .setDescription(`💸 | Preço: ${price || ''}\n📦 | Estoque: ${stock}\nTabela (DB Name): \`${tableName}\`\nUse os Botões abaixo para adicionar ou limpar o estoque.`)
    .setColor('DarkGreen');


const closeDatabase = () => {
  if (!db) return;
  db.close((error) => {
    if (error) {
      console.error('Erro ao encerrar produtos.db:', error);
    }
  });
};

process.once('exit', closeDatabase);
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.once(signal, () => {
    closeDatabase();
    process.exit(0);
  });
});

if (!token) {
  console.error('Defina DISCORD_TOKEN em um .env ou variavel de ambiente.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once('clientReady', () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

const updatePanelEmbed = async (tableName, stock) => {
  const metadataList = panelMetadataByTable.get(tableName);
  if (!metadataList?.length) return;
  for (const metadata of metadataList.slice()) {
    try {
      const channel = await client.channels.fetch(metadata.channelId);
      if (!channel?.isTextBased?.()) continue;
      const message = await channel.messages.fetch(metadata.messageId);
      const embed = buildVendaEmbed(metadata.session, stock);
      await message.edit({ embeds: [embed] });
    } catch (error) {
      console.error('Erro atualizando painel de estoque', error);
    }
  }
};

const refreshPanelEmbed = async (tableName) => {
  try {
    const total = await getStockCount(tableName);
    await updatePanelEmbed(tableName, total);
  } catch (error) {
    console.error('Erro atualizando painel de estoque', error);
  }
};

const ticketSessions = new Map();
const saleSessions = new Map();
const buttonSaleSessions = new Map();
const supportMenus = new Map();
const productMenus = new Map();
const panelMetadataByTable = new Map();
const panelMetadataByMessageId = new Map();
const priceOverrides = new Map();
const stockMessagesByTable = new Map();
const orderSessions = new Map();
const paymentReferences = new Map();
const PENDING_PAYMENTS_FILE = path.join(DATA_DIR, 'pending_payments.json');

const serializePaymentEntry = (entry) => {
  if (!entry?.state) return null;
  return {
    state: entry.state,
    processed: Boolean(entry.processed),
    processing: Boolean(entry.processing)
  };
};

const savePendingPayments = () => {
  try {
    const payload = {};
    for (const [reference, entry] of paymentReferences.entries()) {
      const serialized = serializePaymentEntry(entry);
      if (serialized) payload[reference] = serialized;
    }
    fs.writeFileSync(PENDING_PAYMENTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Erro ao salvar pagamentos pendentes', error);
  }
};

const loadPendingPayments = () => {
  try {
    if (!fs.existsSync(PENDING_PAYMENTS_FILE)) return;
    const raw = fs.readFileSync(PENDING_PAYMENTS_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    for (const [reference, entry] of Object.entries(parsed || {})) {
      if (entry?.state && !entry.processed) {
        paymentReferences.set(reference, { state: entry.state, processed: false, processing: false });
      }
    }
    if (paymentReferences.size) {
      console.log(`[MP WEBHOOK] ${paymentReferences.size} pagamento(s) pendente(s) restaurado(s) do disco.`);
    }
  } catch (error) {
    console.error('Erro ao carregar pagamentos pendentes', error);
  }
};

const setPendingPayment = (reference, state) => {
  paymentReferences.set(reference, { state, processed: false, processing: false });
  savePendingPayments();
};

const removePendingPayment = (reference) => {
  paymentReferences.delete(reference);
  savePendingPayments();
};

loadPendingPayments();

const normalizeColor = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return trimmed;
};

const respondEphemeral = async (interaction, content) => {
  if (!interaction) return null;
  const options = { content, flags: MessageFlags.Ephemeral };
  const sendReply = () => interaction.reply(options);
  const sendFollowUp = () => interaction.followUp(options);
  try {
    if (interaction.acknowledged || interaction.deferred || interaction.replied) {
      return await sendFollowUp();
    }
    return await sendReply();
  } catch (error) {
    const errorCode = error?.code || error?.rawError?.code;
    if (errorCode === 40060 || errorCode === 10062) {
      return null;
    }
    throw error;
  }
};

const awaitUserResponse = async (interaction, prompt) => {
  if (!interaction.channel) return null;
  await respondEphemeral(interaction, prompt);
  try {
    const collected = await interaction.channel.awaitMessages({
      filter: (msg) => msg.author.id === interaction.user.id && msg.channelId === interaction.channelId,
      max: 1,
      time: 60000,
      errors: ['time']
    });
    const response = collected.first();
    if (response) {
      if (response.attachments.size === 0) {
        response.delete().catch(() => null);
      }
      return response;
    }
    return null;
  } catch (error) {
    await respondEphemeral(interaction, 'Tempo esgotado. Tente novamente.');
    return null;
  }
};

const updateStockMessage = async (channel, tableName, stock, price) => {
  if (!channel?.isTextBased?.()) return;
  const messageId = stockMessagesByTable.get(tableName);
  if (!messageId) return;
  try {
    const message = await channel.messages.fetch(messageId);
    const embed = buildStockEmbed(tableName, stock, price);
    await message.edit({ embeds: [embed] });
  } catch (error) {
    console.error('Erro refletindo estoque no painel de addestoque', error);
  }
};

const createTicketControlRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:title').setLabel('Título').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:description').setLabel('Descrição').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:image').setLabel('Imagem').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:supports').setLabel('Suportes').setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:color').setLabel('Cor da embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:send').setLabel('Enviar ticket').setStyle(ButtonStyle.Success)
  )
];

const createVendaControlRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendamenu:title').setLabel('Título').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendamenu:description').setLabel('Descrição').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendamenu:image').setLabel('Imagem').setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendamenu:products').setLabel('Produtos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendamenu:price').setLabel('Preço').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendamenu:color').setLabel('Cor da embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendamenu:dbname').setLabel('DB Name').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendamenu:send').setLabel('Enviar painel').setStyle(ButtonStyle.Success)
  )
];

const createVendaBotaoControlRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendabotao:title').setLabel('Título').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendabotao:description').setLabel('Descrição').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendabotao:image').setLabel('Imagem').setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendabotao:price').setLabel('Preço').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendabotao:color').setLabel('Cor da embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendabotao:dbname').setLabel('DB Name').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendabotao:send').setLabel('Enviar painel').setStyle(ButtonStyle.Success)
  )
];

const createVendaBuyButtonRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendabotao:comprar').setLabel('Comprar').setStyle(ButtonStyle.Success)
  );

const buildVendaEmbed = (session, stock = 0) => {
  const descriptionPart = session.description?.trim() || '';
  const embed = new EmbedBuilder()
    .setTitle(session.title || 'Painel de venda')
    .setDescription(`${descriptionPart}\n\n💸 | Preço: ${session.price || ''}\n📦 | Estoque: ${stock}`)
    .setColor(session.color || '#5865F2');

  if (session.imageURL) {
    embed.setImage(session.imageURL);
  }

  return embed;
};

const buildProductSelectRow = (products) => {
  if (!products?.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('vendamenu_products')
      .setPlaceholder('Clique para abrir')
      .addOptions(
        products.slice(0, 25).map((label, index) => ({
          label: label.slice(0, 100),
          value: `product:${index}`,
          description: label.slice(0, 100)
        }))
      )
  );
};

const registerPanelMetadata = (tableName, metadataEntry) => {
  if (!tableName || !metadataEntry?.messageId) return;
  const existing = panelMetadataByTable.get(tableName) || [];
  const filtered = existing.filter((item) => item.messageId !== metadataEntry.messageId);
  filtered.push(metadataEntry);
  panelMetadataByTable.set(tableName, filtered);
  panelMetadataByMessageId.set(metadataEntry.messageId, { tableName, entry: metadataEntry });
  persistPanelMetadataEntry(tableName, metadataEntry).catch((error) => {
    console.error('Falha ao persistir metadados de painel', error);
  });
};

const resolveSessionTableStock = async (session) => {
  const tableKey = sanitizeTableName(session.dbname);
  if (!tableKey) return { tableKey: null, stock: 0 };
  try {
    await ensureProductTable(tableKey);
    const stock = await getStockCount(tableKey);
    return { tableKey, stock };
  } catch (error) {
    console.error('Erro ao resolver estoque da sessão', error);
    return { tableKey, stock: 0 };
  }
};

const parsePriceNumber = (label) => {
  if (!label) return 0;
  const cleaned = label
    .replace(/[^\d,.\-]/g, '')
    .replace(',', '.');
  const numeric = parseFloat(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatCurrencyValue = (value) => {
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  } catch {
    return `R$ ${value.toFixed(2)}`;
  }
};

const buildOrderEmbed = (state) => {
  const quantity = Number.isFinite(state.quantity) ? state.quantity : 1;
  const stock = Number.isFinite(state.stock) ? state.stock : 0;
  const total = Number.isFinite(state.priceNumber) ? state.priceNumber * quantity : 0;
  const embed = new EmbedBuilder()
    .setTitle(state.title ? `Compra - ${state.title}` : 'Compra em andamento')
    .setDescription(state.description || 'Revise os detalhes antes de confirmar.')
    .setColor(state.color || '#5865F2')
    .addFields(
      { name: 'Preço unitário', value: state.priceLabel || '', inline: true },
      { name: 'Quantidade escolhida', value: String(quantity), inline: true },
      { name: 'Estoque disponível', value: String(stock), inline: true },
      { name: 'Total aproximado', value: formatCurrencyValue(total), inline: true },
      { name: 'Cupom aplicado', value: state.coupon || 'Nenhum', inline: true },
      { name: 'Tabela (DB Name)', value: state.tableName || '', inline: true }
    );
  if (state.imageURL) {
    embed.setImage(state.imageURL);
  }
  return embed;
};

const calculateOrderTotal = (state) => {
  const quantity = Number.isFinite(state.quantity) ? state.quantity : 1;
  const unitPrice = Number.isFinite(state.priceNumber) ? state.priceNumber : 0;
  const total = quantity * unitPrice;
  if (!Number.isFinite(total)) return 0;
  return Number(total.toFixed(2));
};

const buildPaymentSummaryEmbed = (state) => {
  const total = calculateOrderTotal(state);
  const embed = new EmbedBuilder()
    .setTitle('Confirmação de pagamento')
    .setDescription('Revise a quantidade e o total antes de gerar o PIX.')
    .setColor('#2d8c00')
    .addFields(
      { name: 'Produto', value: state.title || 'Pedido', inline: true },
      { name: 'Quantidade', value: String(Number.isFinite(state.quantity) ? state.quantity : 1), inline: true },
      { name: 'Total', value: formatCurrencyValue(total), inline: true },
      { name: 'Preço unitário', value: state.priceLabel || '', inline: true }
    );
  if (state.coupon) {
    embed.addFields({ name: 'Cupom aplicado', value: state.coupon, inline: true });
  }
  if (state.imageURL) {
    embed.setImage(state.imageURL);
  }
  return embed;
};

const buildPixResultEmbed = (state, pixData) => {
  const total = calculateOrderTotal(state);
  const embed = new EmbedBuilder()
    .setTitle('PIX gerado')
    .setDescription('Escaneie o QR Code ou copie o cdigo para finalizar o pagamento.')
    .setColor('#2d8c00')
    .addFields(
      { name: 'Produto', value: state.title || 'Pedido', inline: true },
      { name: 'Quantidade', value: String(Number.isFinite(state.quantity) ? state.quantity : 1), inline: true },
      { name: 'Valor total', value: formatCurrencyValue(total), inline: true },
      { name: 'Cdigo PIX', value: pixData.qrCode || '', inline: false }
    );
  if (pixData.status) {
    embed.addFields({ name: 'Status', value: pixData.status, inline: true });
  }
  if (pixData.expirationDate) {
    const expiresAt = new Date(pixData.expirationDate).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    });
    embed.addFields({ name: 'Vlido at', value: expiresAt, inline: true });
  }
  if (state.imageURL && !embed.data.image) {
    embed.setImage(state.imageURL);
  }
  if (pixData.qrCodeBase64) {
    embed.setImage('attachment://pix.png');
  }
  return embed;
};

const buildGeneratePixRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('order:gerarpix').setLabel('Gerar PIX').setStyle(ButtonStyle.Success)
  );

const buildPixCopyRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('order:copy_pix').setLabel('Copiar cdigo PIX').setStyle(ButtonStyle.Secondary)
  );

const updateOrderMessageEmbed = async (state) => {
  if (!state?.channelId || !state?.messageId) return;
  try {
    const channel = await client.channels.fetch(state.channelId);
    if (!channel?.isTextBased?.()) return;
    const message = await channel.messages.fetch(state.messageId);
    const embed = buildOrderEmbed(state);
    await message.edit({ embeds: [embed] });
  } catch (error) {
    console.error('Erro ao atualizar embed de pedido', error);
  }
};

const createOrderButtonRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('order:add').setLabel('Adicionar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('order:subtract').setLabel('Remover').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('order:setqty').setLabel('Quantidade').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('order:coupon').setLabel('Cupom').setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('order:confirm').setLabel('Confirmar compra').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('order:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
  )
];

const cleanupMetadataForTable = (tableName) => {
  for (const [messageId, metadata] of panelMetadataByMessageId.entries()) {
    if (metadata.tableName === tableName) {
      panelMetadataByMessageId.delete(messageId);
    }
  }
  deletePanelMetadataByTable(tableName).catch((error) => {
    console.error('Falha ao limpar metadados de painel no banco', error);
  });
};

const sanitizeChannelName = (value = '') =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

const hasClosePermission = (member) =>
  CLOSE_ROLE_IDS.some((roleId) => member?.roles.cache.has(roleId));

const createSupportChannel = async (interaction, supportLabel) => {
  const guild = interaction.guild;
  if (!guild) throw new Error('Guild não encontrada.');
  const creatorPart = sanitizeChannelName(interaction.user.username) || 'usuario';
  const channelName = `sup-${creatorPart}-${interaction.user.id}`.slice(0, 90);
  const existing = guild.channels.cache.find(
    (ch) =>
      ch.name === channelName &&
      ch.parentId === TICKET_CATEGORY_ID &&
      ch.type === ChannelType.GuildText
  );
  if (existing) return existing;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: COMMAND_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: SUPPORT_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: SUPPORT_ROLE_ID_2,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ]
  });

  const supportEmbed = new EmbedBuilder()
    .setTitle('Clique para abrir')
    .setDescription(
      'Descreva o seu problema com o mximo de detalhes e aguarde a equipe responder neste canal. Continue por aqui at o suporte encerrar o atendimento.'
    )
    .setColor('Gold')
    .addFields(
      {
        name: 'Instruções',
        value: 'Mantenha a conversa por aqui, no abra mltiplos tickets e aguarde pela equipe.',
        inline: false
      },
      { name: 'Quem abriu', value: `${interaction.user.tag}`, inline: true },
      { name: 'Suporte solicitado', value: supportLabel || '', inline: true }
    );

  const supportRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('support:close').setLabel('Fechar ticket').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('support:delete').setLabel('Excluir ticket').setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [supportEmbed],
    components: [supportRow],
    allowedMentions: { users: [interaction.user.id] }
  });

  await sendWebhookNotification(WEBHOOKS.open, {
    title: 'Abriu ticket',
    description: `${interaction.user.tag} criou ${channel.name}`,
    color: 0x2d8c00,
    fields: [
      { name: 'Suporte', value: supportLabel || '', inline: true },
      { name: 'Canal', value: `<#${channel.id}>`, inline: true }
    ],
    timestamp: new Date().toISOString()
  });

  return channel;
};

const sendWebhookNotification = async (url, embed) => {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (error) {
    console.error(`Falha ao enviar log para o webhook ${url}:`, error);
  }
};

const sendPaymentConfirmationWebhookNotification = async (payload) => {
  if (!PAYMENT_CONFIRMATION_WEBHOOK_URL) return;
  try {
    await fetch(PAYMENT_CONFIRMATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Falha ao enviar webhook de Confirmação de pagamento', error);
  }
};

const collectRequestBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });

const fetchMercadoPagoPaymentDetails = async (paymentId) => {
  if (!paymentId) return null;
  if (!MERCADO_PAGO_ACCESS_TOKEN) {
    return null;
  }
  const response = await fetch(`${MERCADO_PAGO_API_URL}/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new Error(`Falha ao buscar pagamento MP: ${response.status} ${errorBody}`);
  }
  const result = await response.json().catch(() => null);
  return result;
};

const processPaymentConfirmation = async (paymentInfo) => {
  if (!paymentInfo) return;
  if (paymentInfo.status !== 'approved') return;
  const reference = paymentInfo.external_reference;
  console.log('[MP WEBHOOK] external_reference recebido:', reference);
  if (!reference) return;
  const entry = paymentReferences.get(reference);
  if (!entry) {
    console.log(`[MP WEBHOOK] referência ${reference} não encontrada entre pendências.`);
    return;
  }
  if (entry.processing) return;
  entry.processing = true;
  try {
    const state = entry.state;
    const total = calculateOrderTotal(state);
    const { tableName: sanitizedTableName, rows: reservedItems, ids: reservedIds } = await reserveStockItems(
      state.tableName,
      state.quantity
    );
    if (sanitizedTableName) {
      state.tableName = sanitizedTableName;
    }
    const itemList = reservedItems.map((row) => row.item || `item-${row.id}`);
    state.paymentProcessed = true;
    entry.processed = true;
    removePendingPayment(reference);

    const dmEmbed = new EmbedBuilder()
      .setTitle('VgN | Compra aprovada')
      .setDescription('Recebemos a Confirmação do PIX e reservamos seus itens.')
      .setColor('#2d8c00')
      .addFields(
        { name: '🛒 Produto', value: state.title || 'Pedido', inline: true },
        { name: '✏️ Quantidade', value: String(state.quantity), inline: true },
        { name: '💸 Valor total', value: formatCurrencyValue(total), inline: true },
        { name: '🔔 Seus produtos', value: itemList.length ? itemList.join(', ') : 'Nenhum item listado', inline: false },
      );
    try {
      const buyer = await client.users.fetch(state.userId);
      await buyer.send({ embeds: [dmEmbed] });
      console.log(`[MP WEBHOOK] DM enviada para ${state.userId}.`);
    } catch (error) {
      console.error('Erro ao enviar DM de Confirmação', error);
    }

    try {
      const orderChannel = await client.channels.fetch(state.channelId).catch(() => null);
      if (orderChannel?.isTextBased?.()) {
        console.log(`[MP WEBHOOK] enviando confirmação no canal ${state.channelId}.`);
        await orderChannel.send({
          content: `<@${state.userId}> pagamento confirmado!`,
          embeds: [
            new EmbedBuilder()
              .setTitle('Pagamento reconhecido')
              .setDescription('Itens removidos do estoque para evitar duplicidade.')
              .setColor('#2d8c00')
              .addFields(
                { name: 'Itens reservados', value: itemList.length ? itemList.join(', ') : 'Nenhum item listado', inline: false },
                { name: 'Quantidade', value: String(state.quantity), inline: true },
                { name: 'Valor', value: formatCurrencyValue(total), inline: true }
              )
          ]
        });
      }
    } catch (error) {
      console.error('Erro ao avisar canal de pedido', error);
    }

    try {
      await refreshPanelEmbed(state.tableName);
      const remainingStock = await getStockCount(state.tableName);
      state.stock = remainingStock;
      await updateOrderMessageEmbed(state);
    } catch (error) {
      console.error('Erro ao atualizar embed de estoque após Confirmação', error);
    }

    await finalizeDeliveredProducts(state.tableName, reservedIds);

    await sendWebhookNotification(WEBHOOKS.saleConfirm, {
      title: 'Venda concluída',
      description: `${state.userTag || 'Cliente'} recebeu o pedido.`,
      color: 0x2d8c00,
      fields: [
        { name: 'Produto', value: state.title || 'Pedido', inline: true },
        { name: 'Quantidade', value: String(state.quantity), inline: true },
        { name: 'Total', value: formatCurrencyValue(total) || 'R$ 0,00', inline: true },
        { name: 'Tabela', value: state.tableName || '—', inline: true },
        { name: 'Itens removidos', value: itemList.length ? itemList.join(', ') : 'Nenhum item listado', inline: false },
        { name: 'Canal', value: state.channelId ? `<#${state.channelId}>` : '—', inline: true }
      ],
      timestamp: new Date().toISOString()
    });

    await sendPaymentConfirmationWebhookNotification({
      buyerId: state.userId,
      buyerTag: state.userTag,
      product: state.title,
      quantity: state.quantity,
      total: formatCurrencyValue(total),
      items: itemList,
      paymentId: paymentInfo.id,
      tableName: state.tableName
    });
  } catch (error) {
    console.error('Erro ao processar Confirmação de pagamento', error);
  }
};

const handleMercadoPagoWebhook = async (payload) => {
  console.log('[MP WEBHOOK] payload recebido:', JSON.stringify(payload || {}, null, 2));

  const paymentId = payload?.data?.id || payload?.id;
  if (!paymentId) {
    console.log('[MP WEBHOOK] payload sem paymentId, ignorado.');
    return;
  }

  try {
    const paymentInfo = await fetchMercadoPagoPaymentDetails(paymentId);
    console.log('[MP WEBHOOK] pagamento consultado:', JSON.stringify(paymentInfo || {}, null, 2));
    await processPaymentConfirmation(paymentInfo);
  } catch (error) {
    console.error('[MP WEBHOOK] erro tratando webhook do Mercado Pago', error);
  }
};

const startMercadoPagoWebhookServer = () => {
  const server = http.createServer(async (req, res) => {
    console.log('[MP WEBHOOK] requisição recebida:', req.method, req.url);

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'online', webhook: '/mercadopago/webhook' }));
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/mercadopago/webhook')) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Webhook Mercado Pago ativo. Use POST.');
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/mercadopago/webhook')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      const rawBody = await collectRequestBody(req);
      console.log('[MP WEBHOOK] body bruto:', rawBody || '(vazio)');

      const payload = rawBody ? JSON.parse(rawBody) : null;
      await handleMercadoPagoWebhook(payload);

      res.writeHead(200);
      res.end('OK');
    } catch (error) {
      console.error('[MP WEBHOOK] falha ao ler webhook do Mercado Pago', error);
      res.writeHead(400);
      res.end('Bad request');
    }
  });

  server.on('error', (error) => {
    console.error('[MP WEBHOOK] erro no servidor de webhook do Mercado Pago', error);
  });

  server.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`[MP WEBHOOK] ouvindo em ${PAYMENT_CONFIRMATION_WEBHOOK_URL} (porta ${WEBHOOK_PORT})`);
  });
};

const formatPixPayerEmail = (reference = '') => {
  const safeReference = (reference || 'pedido')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32);
  return `${safeReference || 'pedido'}@${MERCADO_PAGO_PAYER_DOMAIN}`;
};

const createMercadoPagoPix = async ({ amount, description, reference, user }) => {
  if (!MERCADO_PAGO_ACCESS_TOKEN) {
    throw new Error('Token do Mercado Pago não configurado.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Valor inválido para gerar o PIX.');
  }
  const payload = {
    transaction_amount: Number(amount.toFixed(2)),
    description: description || 'Pagamento via PIX',
    payment_method_id: 'pix',
    payer: {
      email: formatPixPayerEmail(reference),
      first_name: user?.username || 'Cliente',
      last_name: 'Discord'
    },
    external_reference: reference,
    notification_url: PAYMENT_CONFIRMATION_WEBHOOK_URL
  };

  console.log('[MP PIX] criando pagamento:', JSON.stringify({
    amount: payload.transaction_amount,
    description: payload.description,
    external_reference: payload.external_reference,
    notification_url: payload.notification_url
  }, null, 2));

  const response = await fetch(MERCADO_PAGO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex')
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  console.log('[MP PIX] resposta da criação:', JSON.stringify(result || {}, null, 2));
  if (!response.ok) {
    const message = result?.message || 'Não foi possvel gerar o PIX.';
    throw new Error(message);
  }
  const transactionData = result.point_of_interaction?.transaction_data;
  if (!transactionData) {
    throw new Error('Resposta do Mercado Pago no trouxe dados do PIX.');
  }
  return {
    paymentId: result.id,
    status: result.status,
    qrCode: transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
    expirationDate: transactionData.expiration_date
  };
};

const sendTicketSummary = async (channel, session) => {
  const embed = new EmbedBuilder()
    .setTitle(session.title || 'Ticket')
    .setDescription(session.description || 'Sem descrição definida.')
    .setColor(session.color || '#5865F2');

  if (session.imageURL) {
    embed.setImage(session.imageURL);
  }

  const supports = session.supports || [];
  const supportRow =
    supports.length > 0
      ? new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('ticket_support_select')
            .setPlaceholder('Clique para abrir')
            .addOptions(
              supports.slice(0, 25).map((label, index) => ({
                label: label.slice(0, 100),
                value: `support:${index}`,
                description: label.slice(0, 100)
              }))
            )
        )
      : null;

  const sent = await channel.send({
    embeds: [embed],
    components: supportRow ? [supportRow] : []
  });

  if (supportRow) {
    supportMenus.set(sent.id, supports);
  }
};

const commands = {
  help: {
    description: 'Lista os nomes dos comandos disponiveis.',
    async execute(message) {
      const lista = HELP_COMMAND_NAMES.map((nome) => `${PREFIX}${nome}`);
      await message.reply({
        content: `Comandos disponiveis:\n${lista.join('\n')}`,
        allowedMentions: { repliedUser: false }
      });
    }
  },
  ticket: {
    description: 'Inicia a criação interativa de um ticket.',
    async execute(message) {
      ticketSessions.set(message.author.id, {
        title: null,
        description: null,
        imageURL: null,
        supports: [],
        color: '#5865F2'
      });

      const embed = new EmbedBuilder()
        .setTitle('Configurao do ticket')
        .setDescription(
          'Use os Botões abaixo para definir título, descrição, imagem, suportes e cor. Clique em "Enviar ticket" quando finalizar.'
        )
        .setColor('DarkBlue');

      await message.reply({
        embeds: [embed],
        components: createTicketControlRows(),
        allowedMentions: { repliedUser: false }
      });
    }
  },
  vendamenu: {
    description: 'Configura um painel de vendas com menu interativo.',
    async execute(message) {
      saleSessions.set(message.author.id, {
        title: '',
        description: '',
        imageURL: null,
        products: [],
        price: '',
        color: '#5865F2',
        dbname: ''
      });

      const embed = new EmbedBuilder()
        .setTitle('Configurao de venda')
        .setDescription(
          'Use os Botões para adicionar título, descrição, imagem, produtos, preço, cor e nome da tabela. Clique em "Enviar painel" ao terminar.'
        )
        .setColor('Purple');

      await message.reply({
        embeds: [embed],
        components: createVendaControlRows(),
        allowedMentions: { repliedUser: false }
      });
    }
  },
  vendabotao: {
    description: 'Configura um painel com boto de compra.',
    async execute(message) {
      buttonSaleSessions.set(message.author.id, {
        title: '',
        description: '',
        imageURL: null,
        price: '',
        color: '#5865F2',
        dbname: ''
      });

      const embed = new EmbedBuilder()
        .setTitle('Configurao de venda (boto)')
        .setDescription(
          'Defina título, descrição, imagem, preço, cor e nome da tabela. Clique em "Enviar painel" quando terminar.'
        )
        .setColor('Purple');

      await message.reply({
        embeds: [embed],
        components: createVendaBotaoControlRows(),
        allowedMentions: { repliedUser: false }
      });
    }
  },
  listar: {
    description: 'Exibe um catálogo de exemplo para vendas.',
    async execute(message) {
      await message.reply({
        content:
          'Catálogo de exemplo:\n1. Camiseta PRO - R$ 120\n2. Curso Intensivo - R$ 350\nAbra um ticket para pedir apoio.',
        allowedMentions: { repliedUser: false }
      });
    }
  }
,
  addestoque: {
    description: 'Abre o menu de produtos existentes para ajustar estoque.',
    async execute(message) {
      try {
        const tables = await getProductTables();
        if (!tables.length) {
          await message.reply({
            content: 'Nenhum produto cadastrado. Use .vendamenu ou .vendabotao para criar um antes.',
            allowedMentions: { repliedUser: false }
          });
          return;
        }

        const options = tables.slice(0, 25).map((tableName) => ({
          label: tableName,
          value: tableName,
          description: 'Produto cadastrado'
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('addestoque_select')
            .setPlaceholder('Selecione o produto')
            .addOptions(options)
        );

        const embed = new EmbedBuilder()
          .setTitle('Adicionar estoque')
          .setDescription('Selecione o produto no menu abaixo para saber mais.')
          .setColor('DarkGreen');

        await message.reply({
          embeds: [embed],
          components: [row],
          allowedMentions: { repliedUser: false }
        });
      } catch (error) {
        console.error('Erro buscando tabelas de produtos', error);
        await message.reply({
          content: 'Não foi possível carregar os produtos neste momento.',
          allowedMentions: { repliedUser: false }
        });
      }
    }
  }
};
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const [comando, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  if (!comando) return;

  const registro = commands[comando.toLowerCase()];
  if (!registro) return;

  const member = message.member;
  if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
    await message.reply({
      content: `Vocêê precisa ter o cargo <@&${COMMAND_ROLE_ID}> para usar comandos.`,
      allowedMentions: { repliedUser: false }
    });
    return;
  }

  try {
    await registro.execute(message, args);
  } catch (erro) {
    console.error(`Erro ao executar ${comando}:`, erro);
    await message.reply({
      content: 'Ocorreu um erro ao processar o comando.',
      allowedMentions: { repliedUser: false }
    });
  }
});
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'vendamenu_products') {
        const list = productMenus.get(interaction.message?.id) || [];
        const escolhidos = interaction.values
          .map((value) => {
            const [, indexString] = value.split(':');
            const index = Number(indexString);
            return list[index] || 'Produto';
          })
          .filter(Boolean);
        await respondEphemeral(interaction, `Produto selecionado: ${escolhidos.join(', ')}`);
        return;
      }

      if (interaction.customId === 'addestoque_select') {
        const tableName = interaction.values[0];
        if (!tableName) {
          await respondEphemeral(interaction, 'Selecione um produto vlido.');
          return;
        }
        const sanitizedName = sanitizeTableName(tableName);
        if (!sanitizedName) {
          await respondEphemeral(interaction, 'Nome inválido do produto selecionado.');
          return;
        }
        try {
          const total = await getStockCount(sanitizedName);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`stock:add:${sanitizedName}`)
              .setLabel('Adicionar estoque')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`stock:price:${sanitizedName}`)
              .setLabel('Alterar preço')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`stock:clear:${sanitizedName}`)
              .setLabel('Limpar estoque')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`stock:drop:${sanitizedName}`)
              .setLabel('Excluir tabela')
              .setStyle(ButtonStyle.Danger)
          );
          const priceForEmbed = getPriceForTable(sanitizedName);
          const embed = buildStockEmbed(sanitizedName, total, priceForEmbed);
          const replyMessage = await interaction.reply({
            embeds: [embed],
            components: [row],
            allowedMentions: { repliedUser: false },
            withResponse: true
          });
          if (replyMessage?.id) {
            stockMessagesByTable.set(sanitizedName, replyMessage.id);
          }
        } catch (error) {
          console.error('Erro ao montar embed de estoque', error);
          await respondEphemeral(interaction, 'Não foi possvel carregar o produto selecionado.');
        }
        return;
      }

      if (interaction.customId === 'ticket_support_select') {
        const supports = supportMenus.get(interaction.message?.id) || [];
        const channels = [];
        for (const value of interaction.values) {
          const [, indexString] = value.split(':');
          const index = Number(indexString);
          const label = supports[index] || 'Suporte';
          try {
            const channel = await createSupportChannel(interaction, label);
            channels.push(channel);
          } catch (error) {
            console.error('Erro criando canal de suporte', error);
            await respondEphemeral(interaction, 'Não foi possvel criar o canal de suporte. Verifique permisses e categoria.');
            return;
          }
        }
        const mentions = channels.map((channel) => `<#${channel.id}>`).join(', ');
        await respondEphemeral(interaction, `Canal criado: ${mentions}`);
        return;
      }
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'order_qty_modal') {
        const state = orderSessions.get(interaction.channelId);
        if (!state) {
          await respondEphemeral(interaction, 'sessão de pedido no encontrada.');
          return;
        }
        const requestedValue = interaction.fields.getTextInputValue('order_qty_input');
        let requested = Number.parseInt(requestedValue?.trim(), 10);
        if (!Number.isFinite(requested) || requested < 1) {
          requested = 1;
        }
        const stock = await getStockCount(state.tableName);
        state.stock = stock;
        if (stock <= 0) {
          state.quantity = 0;
          await updateOrderMessageEmbed(state);
          await interaction.reply({ content: 'Estoque indisponível.', flags: MessageFlags.Ephemeral });
          return;
        }
        state.quantity = Math.min(stock, requested);
        await updateOrderMessageEmbed(state);
        await interaction.reply({ content: `Quantidade definida para ${state.quantity}.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.customId === 'order_coupon_modal') {
        const state = orderSessions.get(interaction.channelId);
        if (!state) {
          await respondEphemeral(interaction, 'sessão de pedido no encontrada.');
          return;
        }
        const couponCode = interaction.fields.getTextInputValue('order_coupon_input')?.trim();
        state.coupon = couponCode || null;
        await updateOrderMessageEmbed(state);
        await interaction.reply({
          content: couponCode ? `Cupom definido: ${couponCode}` : 'Cupom limpo.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('vendamenu:')) {
      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await respondEphemeral(interaction, `Você precisa do cargo <@&${COMMAND_ROLE_ID}> para configurar o painel.`);
        return;
      }

      const action = interaction.customId.split(':')[1];
      const session = saleSessions.get(interaction.user.id);
      if (!session) {
        await respondEphemeral(interaction, 'Nenhuma sessão encontrada. Inicie o comando novamente.');
        return;
      }

      const promptForValue = async (texto) => {
        const response = await awaitUserResponse(interaction, texto);
        return response?.content?.trim();
      };

      if (action === 'title') {
        const texto = await promptForValue('Defina o título do painel.');
        if (texto) {
          session.title = texto;
          saleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Título atualizado.');
        }
        return;
      }

      if (action === 'description') {
        const texto = await promptForValue('Defina a descrição do painel.');
        if (texto) {
          session.description = texto;
          saleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Descrição atualizada.');
        }
        return;
      }

      if (action === 'image') {
        const resposta = await awaitUserResponse(interaction, 'Envie uma imagem ou cole a URL (digite "remover" para limpar).');
        if (!resposta) return;
        const attachment = resposta.attachments.first();
        if (attachment) {
          session.imageURL = attachment.url;
        } else if (resposta.content?.trim()?.toLowerCase() === 'remover') {
          session.imageURL = null;
        } else if (resposta.content?.trim()) {
          session.imageURL = resposta.content.trim();
        }
        saleSessions.set(interaction.user.id, session);
        await respondEphemeral(interaction, 'Imagem atualizada.');
        return;
      }

      if (action === 'products') {
        const texto = await promptForValue('Liste os produtos separados por vrgula (ex: Camiseta, Curso, Mentoria).');
        if (texto) {
          session.products = texto
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 25);
          saleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Produtos registrados.');
        }
        return;
      }

      if (action === 'price') {
        const texto = await promptForValue('Informe o preço que ser exibido (ex: R$ 120).');
        if (texto) {
          session.price = texto;
          saleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Preço atualizado.');
        }
        return;
      }

      if (action === 'color') {
        const texto = await promptForValue('Informe um cdigo de cor em hexadecimal (ex: #ff8800) ou nome.');
        if (texto) {
          const color = normalizeColor(texto);
          if (color) {
            session.color = color;
            saleSessions.set(interaction.user.id, session);
            await respondEphemeral(interaction, 'Cor atualizada.');
          } else {
            await respondEphemeral(interaction, 'Cor inválida. Use #rrggbb ou um nome vlido.');
          }
        }
        return;
      }

      if (action === 'dbname') {
        const texto = await promptForValue('Defina o nome da tabela (dbname).');
        if (texto) {
          const sanitized = sanitizeTableName(texto);
          if (!sanitized) {
            await respondEphemeral(interaction, 'Nome inválido. Use apenas letras, nmeros e underline.');
            return;
          }
          try {
            await ensureProductTable(sanitized);
            session.dbname = sanitized;
            saleSessions.set(interaction.user.id, session);
            await respondEphemeral(interaction, `Tabela "${sanitized}" criada/confirmada.`);
          } catch (error) {
            console.error('Erro criando tabela no SQLite', error);
            await respondEphemeral(interaction, 'Não foi possível criar a tabela no banco de dados.');
          }
        }
        return;
      }

      if (action === 'send') {
        const { tableKey, stock } = await resolveSessionTableStock(session);
        const embed = buildVendaEmbed(session, stock);
        const menu = buildProductSelectRow(session.products);
        await respondEphemeral(interaction, 'Painel pronto! Está sendo publicado.');
        const sent = await interaction.channel.send({
          embeds: [embed],
          components: menu ? [menu] : [],
          allowedMentions: { repliedUser: false }
        });
        if (menu) {
          productMenus.set(sent.id, session.products);
        }
        if (tableKey) {
          const resolvedPrice = priceOverrides.get(tableKey) || session.price;
          const metaSession = {
            title: session.title,
            description: session.description,
            imageURL: session.imageURL,
            price: resolvedPrice,
            color: session.color
          };
          const metadataEntry = {
            channelId: interaction.channel.id,
            messageId: sent.id,
            session: metaSession
          };
          registerPanelMetadata(tableKey, metadataEntry);
        }
        saleSessions.delete(interaction.user.id);
        return;
      }
    }

    if (interaction.customId.startsWith('vendabotao:')) {
      const action = interaction.customId.split(':')[1];
      if (action === 'comprar') {
        const panelMetadata = panelMetadataByMessageId.get(interaction.message?.id);
        const metadata = panelMetadata?.entry?.session;
        const tableName = panelMetadata?.tableName;
        if (!tableName) {
          await respondEphemeral(interaction, 'Produto no está vinculado a uma tabela, contate a equipe.');
          return;
        }
        const stock = await getStockCount(tableName);
        if (stock <= 0) {
          await respondEphemeral(interaction, 'Estoque indisponível no momento.');
          return;
        }
        const priceLabel = metadata?.price || '';
        const priceNumber = parsePriceNumber(priceLabel);
        const orderState = {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          tableName,
          priceLabel,
          priceNumber,
          title: metadata?.title || interaction.message?.embeds?.[0]?.title,
          description: metadata?.description || interaction.message?.embeds?.[0]?.description,
          imageURL: metadata?.imageURL || interaction.message?.embeds?.[0]?.image?.url,
          color: metadata?.color || interaction.message?.embeds?.[0]?.color || '#5865F2',
          stock,
          quantity: 1,
          coupon: null
        };
        const guild = interaction.guild;
        if (!guild) {
          await respondEphemeral(interaction, 'Falha ao criar canal de compra. Tente novamente.');
          return;
        }
        const requester = sanitizeChannelName(interaction.user.username) || 'cliente';
        const channelName = `pedido-${requester}-${interaction.user.id}`.slice(0, 90);
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: ORDER_CATEGORY_ID,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            {
              id: interaction.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: COMMAND_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: SUPPORT_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: SUPPORT_ROLE_ID_2,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            }
          ]
        });
        const orderEmbed = buildOrderEmbed({ ...orderState, channelName: channel.name });
        const orderMessage = await channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: [orderEmbed],
          components: createOrderButtonRows(),
          allowedMentions: { users: [interaction.user.id] }
        });
        orderState.channelId = channel.id;
        orderState.messageId = orderMessage.id;
        orderSessions.set(channel.id, orderState);
        await sendWebhookNotification(WEBHOOKS.orderCreate, {
          title: 'Canal de compra aberto',
          description: `${interaction.user.tag} criou ${channel.name}`,
          color: 0x2d8c00,
          fields: [
            { name: 'Produto', value: orderState.title || '', inline: true },
            { name: 'Estoque atual', value: String(stock), inline: true },
            { name: 'Canal', value: `<#${channel.id}>`, inline: true }
          ],
          timestamp: new Date().toISOString()
        });
        await respondEphemeral(interaction, `Canal criado: <#${channel.id}>. Acompanhe por l.`);
        return;
      }

      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await respondEphemeral(interaction, `Você precisa do cargo <@&${COMMAND_ROLE_ID}> para configurar o painel.`);
        return;
      }

      const session = buttonSaleSessions.get(interaction.user.id);
      if (!session) {
        await respondEphemeral(interaction, 'Nenhuma sessão encontrada. Inicie o comando novamente.');
        return;
      }

      const promptForValue = async (texto) => {
        const response = await awaitUserResponse(interaction, texto);
        return response?.content?.trim();
      };

      if (action === 'title') {
        const texto = await promptForValue('Defina o título do painel.');
        if (texto) {
          session.title = texto;
          buttonSaleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Título atualizado.');
        }
        return;
      }

      if (action === 'description') {
        const texto = await promptForValue('Defina a descrição do painel.');
        if (texto) {
          session.description = texto;
          buttonSaleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Descrição atualizada.');
        }
        return;
      }

      if (action === 'image') {
        const resposta = await awaitUserResponse(interaction, 'Envie uma imagem ou cole a URL (digite "remover" para limpar).');
        if (!resposta) return;
        const attachment = resposta.attachments.first();
        if (attachment) {
          session.imageURL = attachment.url;
        } else if (resposta.content?.trim()?.toLowerCase() === 'remover') {
          session.imageURL = null;
        } else if (resposta.content?.trim()) {
          session.imageURL = resposta.content.trim();
        }
        buttonSaleSessions.set(interaction.user.id, session);
        await respondEphemeral(interaction, 'Imagem atualizada.');
        return;
      }

      if (action === 'price') {
        const texto = await promptForValue('Informe o preço que ser exibido (ex: R$ 120).');
        if (texto) {
          session.price = texto;
          buttonSaleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Preço atualizado.');
        }
        return;
      }

      if (action === 'color') {
        const texto = await promptForValue('Informe um código de cor em hexadecimal (ex: #ff8800) ou nome.');
        if (texto) {
          const color = normalizeColor(texto);
          if (color) {
            session.color = color;
            buttonSaleSessions.set(interaction.user.id, session);
            await respondEphemeral(interaction, 'Cor atualizada.');
          } else {
            await respondEphemeral(interaction, 'Cor inválida. Use #rrggbb ou um nome vlido.');
          }
        }
        return;
      }

      if (action === 'dbname') {
        const texto = await promptForValue('Defina o nome da tabela (dbname).');
        if (texto) {
          const sanitized = sanitizeTableName(texto);
          if (!sanitized) {
            await respondEphemeral(interaction, 'Nome inválido. Use apenas letras, nmeros e underline.');
            return;
          }
          try {
            await ensureProductTable(sanitized);
            session.dbname = sanitized;
            buttonSaleSessions.set(interaction.user.id, session);
            await respondEphemeral(interaction, `Tabela "${sanitized}" criada/confirmada.`);
          } catch (error) {
            console.error('Erro criando tabela no SQLite', error);
            await respondEphemeral(interaction, 'Não foi possvel criar a tabela no banco de dados.');
          }
        }
        return;
      }

      if (action === 'send') {
        const { tableKey, stock } = await resolveSessionTableStock(session);
        const embed = buildVendaEmbed(session, stock);
        const row = createVendaBuyButtonRow();
        await respondEphemeral(interaction, 'Painel pronto! Está sendo publicado.');
        const sent = await interaction.channel.send({
          embeds: [embed],
          components: [row],
          allowedMentions: { repliedUser: false }
        });
        if (tableKey) {
          const resolvedPrice = priceOverrides.get(tableKey) || session.price;
          const metaSession = {
            title: session.title,
            description: session.description,
            imageURL: session.imageURL,
            price: resolvedPrice,
            color: session.color
          };
          const metadataEntry = {
            channelId: interaction.channel.id,
            messageId: sent.id,
            session: metaSession
          };
          registerPanelMetadata(tableKey, metadataEntry);
        }
        buttonSaleSessions.delete(interaction.user.id);
        return;
      }
    }

    if (interaction.customId.startsWith('order:')) {
      const action = interaction.customId.split(':')[1];
      const state = orderSessions.get(interaction.channelId);
      if (!state) {
        await respondEphemeral(interaction, 'sessão de pedido encerrada ou invlida.');
        return;
      }
      const stock = await getStockCount(state.tableName);
      state.stock = stock;

      if (action === 'add') {
        if (stock <= 0) {
          await respondEphemeral(interaction, 'Estoque esgotado.');
          return;
        }
        if (state.quantity >= stock) {
          await respondEphemeral(interaction, 'Quantidade já atingiu o limite do estoque.');
          return;
        }
        state.quantity += 1;
        await updateOrderMessageEmbed(state);
        await interaction.deferUpdate();
        return;
      }

      if (action === 'subtract') {
        if (state.quantity <= 1) {
          await respondEphemeral(interaction, 'Quantidade mnima  1.');
          return;
        }
        state.quantity -= 1;
        await updateOrderMessageEmbed(state);
        await interaction.deferUpdate();
        return;
      }

      if (action === 'setqty') {
        const modal = new ModalBuilder().setCustomId('order_qty_modal').setTitle('Definir quantidade');
        const input = new TextInputBuilder()
          .setCustomId('order_qty_input')
          .setLabel('Quantos itens deseja comprar?')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (action === 'coupon') {
        const modal = new ModalBuilder().setCustomId('order_coupon_modal').setTitle('Aplicar cupom');
        const input = new TextInputBuilder()
          .setCustomId('order_coupon_input')
          .setLabel('Cdigo do cupom (opcional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (action === 'confirm') {
        if (stock <= 0) {
          await respondEphemeral(interaction, 'O estoque acabou. Ajuste o pedido.');
          return;
        }
        if (state.quantity > stock) {
          state.quantity = stock;
          await updateOrderMessageEmbed(state);
          await respondEphemeral(interaction, 'Quantidade ajustada para o estoque disponvel.');
          return;
        }
        const summaryEmbed = buildPaymentSummaryEmbed(state);
        try {
          const summaryMessage = await interaction.channel.send({
            embeds: [summaryEmbed],
            components: [buildGeneratePixRow()],
            allowedMentions: { users: [interaction.user.id] }
          });
          if (summaryMessage?.id) {
            state.paymentSummaryMessageId = summaryMessage.id;
          }
        } catch (error) {
          console.error('Erro ao enviar resumo de pagamento', error);
        }
        orderSessions.set(interaction.channelId, state);
        await respondEphemeral(interaction, 'Pedido registrado! Confira o resumo no canal e gere o PIX.');
        return;
      }

      if (action === 'gerarpix') {
        const total = calculateOrderTotal(state);
        const reference = `${state.tableName || 'pedido'}-${state.userId}-${Date.now()}`
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 64);
        try {
          const pixData = await createMercadoPagoPix({
            amount: total,
            description: `${state.title || 'Pagamento'} (${state.quantity}x)`,
            reference,
            user: interaction.user
          });
          state.pixData = pixData;
          const attachments = pixData.qrCodeBase64
            ? [
                {
                  attachment: Buffer.from(pixData.qrCodeBase64, 'base64'),
                  name: 'pix.png'
                }
              ]
            : [];
          const pixEmbed = buildPixResultEmbed(state, pixData);
          try {
            await interaction.channel.send({
              embeds: [pixEmbed],
              components: [buildPixCopyRow()],
              files: attachments,
              allowedMentions: { users: [interaction.user.id] }
            });
          } catch (error) {
            console.error('Erro ao enviar embed de PIX', error);
          }
          state.paymentReference = reference;
          state.paymentProcessed = false;
          setPendingPayment(reference, state);
          orderSessions.set(interaction.channelId, state);
          console.log(`[MP PIX] pendência registrada para ${reference}.`);
          await respondEphemeral(interaction, 'PIX gerado! O QR Code e o cdigo aparecem abaixo.');
        } catch (error) {
          console.error('Erro ao gerar PIX', error);
          await respondEphemeral(interaction, `No foi possível gerar o PIX. ${error.message || ''}`.trim());
        }
        return;
      }

      if (action === 'copy_pix') {
        const pixCode = state.pixData?.qrCode;
        if (!pixCode) {
          await respondEphemeral(interaction, 'Ainda não há PIX gerado para copiar.');
          return;
        }
        await respondEphemeral(interaction, `Código PIX:\n\`\`\`${pixCode}\`\`\``);
        return;
      }

      if (action === 'cancel') {
        await respondEphemeral(interaction, 'Canal ser removido em instantes.');
        const channel = interaction.channel;
        if (channel) {
          const channelName = channel.name;
          await sendWebhookNotification(WEBHOOKS.orderDelete, {
            title: 'Canal de compra removido',
            description: `${interaction.user.tag} cancelou ${channelName}`,
            color: 0x000000,
            fields: [
              { name: 'Canal', value: channelName, inline: true },
              { name: 'ID do canal', value: channel.id, inline: true }
            ],
            timestamp: new Date().toISOString()
          });
          try {
            await channel.delete('Pedido cancelado');
          } catch (error) {
            console.error('Erro ao deletar canal de pedido', error);
          }
        }
        orderSessions.delete(interaction.channelId);
        return;
      }
    }

    if (interaction.customId.startsWith('stock:')) {
      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await respondEphemeral(interaction, `Você precisa do cargo <@&${COMMAND_ROLE_ID}> para mexer no estoque.`);
        return;
      }

      const parts = interaction.customId.split(':');
      const action = parts[1];
      const tableName = parts.slice(2).join(':');
      const sanitizedName = sanitizeTableName(tableName);
      if (!sanitizedName) {
        await respondEphemeral(interaction, 'Nome de tabela inválido.');
        return;
      }

      if (action === 'add') {
        const resposta = await awaitUserResponse(
          interaction,
          'Envie os itens separados por vrgula (ex: key1,key2). Cada valor aumenta o estoque em 1.'
        );
        if (!resposta) return;
        const valores = (resposta.content || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (!valores.length) {
          await respondEphemeral(interaction, 'Nenhum valor válido informado.');
          return;
        }
        try {
          await addStockEntries(sanitizedName, valores);
          await refreshPanelEmbed(sanitizedName);
          const total = await getStockCount(sanitizedName);
          const priceLine = getPriceForTable(sanitizedName);
          await updateStockMessage(interaction.channel, sanitizedName, total, priceLine);
          await respondEphemeral(interaction, `Adicionados ${valores.length} itens. Estoque agora: ${total}.`);
        } catch (error) {
          console.error('Erro ao adicionar estoque', error);
          await respondEphemeral(interaction, 'No foi possível adicionar o estoque.');
        }
        return;
      }

      if (action === 'price') {
        const resposta = await awaitUserResponse(interaction, 'Informe o preço exibido no painel (ex: R$ 120).');
        if (!resposta) return;
        const valor = resposta.content?.trim();
        if (!valor) {
          await respondEphemeral(interaction, 'Informe um preço válido.');
          return;
        }
        priceOverrides.set(sanitizedName, valor);
        const metadataList = panelMetadataByTable.get(sanitizedName) || [];
        metadataList.forEach((entry) => {
          entry.session.price = valor;
        });
        try {
          const total = await getStockCount(sanitizedName);
          await refreshPanelEmbed(sanitizedName);
          await updateStockMessage(interaction.channel, sanitizedName, total, valor);
          await respondEphemeral(interaction, `Preço atualizado para ${valor}. Estoque atual: ${total}.`);
        } catch (error) {
          console.error('Erro ao atualizar preço', error);
          await respondEphemeral(interaction, 'No foi possível atualizar o preço.');
        }
        return;
      }

      if (action === 'clear') {
        try {
          await clearStockEntries(sanitizedName);
          await refreshPanelEmbed(sanitizedName);
          const priceLine = getPriceForTable(sanitizedName);
          await updateStockMessage(interaction.channel, sanitizedName, 0, priceLine);
          await respondEphemeral(interaction, 'Estoque limpo com sucesso.');
        } catch (error) {
          console.error('Erro ao limpar estoque', error);
          await respondEphemeral(interaction, 'Não foi possvel limpar o estoque.');
        }
        return;
      }

      if (action === 'drop') {
        try {
          await dropStockTable(sanitizedName);
          panelMetadataByTable.delete(sanitizedName);
          priceOverrides.delete(sanitizedName);
          stockMessagesByTable.delete(sanitizedName);
          cleanupMetadataForTable(sanitizedName);
          const dropEmbed = new EmbedBuilder()
            .setTitle('Tabela removida')
            .setDescription(`A tabela **${sanitizedName}** foi excluída do banco de dados.`)
            .setColor('Red');
          if (interaction.message?.edit) {
            await interaction.message.edit({ embeds: [dropEmbed], components: [] });
          }
          await respondEphemeral(interaction, 'Tabela excluída. O estoque foi zerado e a tabela removida.');
        } catch (error) {
          console.error('Erro ao excluir tabela', error);
          await respondEphemeral(interaction, 'Não foi possível excluir a tabela.');
        }
        return;
      }
    }

    if (interaction.customId.startsWith('support:')) {
      if (!hasClosePermission(interaction.member)) {
        await respondEphemeral(interaction, 'Somente a equipe especializada pode usar esse boto.');
        return;
      }

      if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        await respondEphemeral(interaction, 'Canal inválido.');
        return;
      }

      if (interaction.customId === 'support:close') {
        await interaction.channel.permissionOverwrites.edit(interaction.channel.guild.roles.everyone.id, {
          SendMessages: false
        });
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
          SendMessages: false
        });
        await respondEphemeral(interaction, 'Ticket fechado. A equipe pode continuar respondendo.');
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('Ticket fechado')
              .setDescription('Ninguém mais pode enviar mensagens nesta conversa at que um autorizado reabra.')
              .setColor('Red')
          ]
        });
        await sendWebhookNotification(WEBHOOKS.close, {
          title: 'Fechou ticket',
          description: `${interaction.user.tag} fechou ${interaction.channel.name}`,
          color: 0xf44336,
          fields: [
            { name: 'Canal', value: interaction.channel.name, inline: true },
            { name: 'ID do canal', value: interaction.channel.id, inline: true }
          ],
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (interaction.customId === 'support:delete') {
        await respondEphemeral(interaction, 'Excluindo o canal...');
        const deletedName = interaction.channel.name;
        const deletedId = interaction.channel.id;
        await interaction.channel.delete('Ticket excluído via boto');
        await sendWebhookNotification(WEBHOOKS.delete, {
          title: 'Excluiu ticket',
          description: `${interaction.user.tag} excluiu ${deletedName}`,
          color: 0x000000,
          fields: [
            { name: 'Canal', value: deletedName, inline: true },
            { name: 'ID do canal', value: deletedId, inline: true }
          ],
          timestamp: new Date().toISOString()
        });
        return;
      }
    }

    if (interaction.customId.startsWith('ticket:')) {
      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await respondEphemeral(interaction, `Você precisa do cargo <@&${COMMAND_ROLE_ID}> para manipular tickets.`);
        return;
      }

      let session = ticketSessions.get(interaction.user.id);
      if (!session) {
        session = { title: null, description: null, imageURL: null, supports: [], color: '#5865F2' };
        ticketSessions.set(interaction.user.id, session);
      }

      const action = interaction.customId.split(':')[1];
      if (action === 'send') {
        await respondEphemeral(interaction, 'Montando o ticket...');
        if (interaction.channel) {
          await sendTicketSummary(interaction.channel, session);
        }
        ticketSessions.delete(interaction.user.id);
        return;
      }

      const promptMap = {
        title: 'Qual ser o título do ticket?',
        description: 'Escreva uma descrição para o ticket.',
        image: 'Cole uma URL de imagem ou envie um arquivo (digite "remover" para limpar).',
        supports: 'Liste os nomes das opes de suporte separados por vrgula.',
        color: 'Informe um código hexadecimal (ex: #ff8800) ou um nome de cor.'
      };

      if (!promptMap[action]) {
        await respondEphemeral(interaction, 'Ao desconhecida.');
        return;
      }

      const respostaMensagem = await awaitUserResponse(interaction, promptMap[action]);
      if (!respostaMensagem) return;
      const textoResposta = respostaMensagem.content?.trim() || '';

      if (action === 'supports') {
        session.supports = textoResposta
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 5);
      } else if (action === 'image') {
        const attachment = respostaMensagem.attachments.first();
        if (attachment) {
          session.imageURL = attachment.url;
        } else if (textoResposta.toLowerCase() === 'remover') {
          session.imageURL = null;
        } else if (textoResposta) {
          session.imageURL = textoResposta;
        } else {
          await respondEphemeral(interaction, 'Informe uma URL ou envie um arquivo.');
          return;
        }
      } else if (action === 'color') {
        if (!textoResposta) {
          await respondEphemeral(interaction, 'Informe um texto válido.');
          return;
        }
        session.color = normalizeColor(textoResposta) || session.color;
      } else {
        session[action] = textoResposta;
      }

      ticketSessions.set(interaction.user.id, session);
      await respondEphemeral(interaction, `${action[0].toUpperCase() + action.slice(1)} atualizado!`);
    }
  } catch (error) {
    console.error('Erro ao processar interao', error);
    if (!interaction.replied && !interaction.deferred) {
      await respondEphemeral(interaction, 'Ocorreu um erro ao processar a interação.');
    }
  }
});
startMercadoPagoWebhookServer();
client.login(token).catch((error) => {
  console.error('Falha ao conectar no Discord:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
