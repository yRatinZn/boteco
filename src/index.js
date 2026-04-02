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
  orderDelete: 'https://discordapp.com/api/webhooks/1487186566194659532/QfGKIT4PXXp7ydjgYHyYptKfyat5MTJugjgBVGqXuJWvWAEpbuX9wKpX6-t-y8Xw_lno'
};
const DEFAULT_HELP_COMMANDS = ['help', 'ticket', 'vendamenu', 'vendabotao', 'listar', 'addestoque', 'addestoquemenu'];
const HELP_COMMAND_NAMES =
  process.env.HELP_COMMANDS ? process.env.HELP_COMMANDS.split(',').map((nome) => nome.trim()).filter(Boolean) : DEFAULT_HELP_COMMANDS;
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || process.env.PORT) || 3000;
const PAYMENT_CONFIRMATION_WEBHOOK_URL = process.env.PAYMENT_CONFIRMATION_WEBHOOK_URL?.trim();
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
const MERCADO_PAGO_PAYER_DOMAIN = process.env.MERCADO_PAGO_PAYER_DOMAIN?.trim() || 'pix.vg';
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1/payments';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'produtos.db');
const MENU_DB_FILE = path.join(DATA_DIR, 'produtosmenu.db');
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
      reject(new Error('Nome da tabela invlido.'));
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

const getStockCount = async (tableName) => {
  const sanitized = sanitizeTableName(tableName);
  if (!sanitized) return 0;
  await ensureProductTable(sanitized);
  return new Promise((resolve, reject) => {
    const sql = `SELECT COALESCE(SUM(stock), 0) AS total FROM "${sanitized}"`;
    db.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row?.total || 0);
    });
  });
};

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

const PRODUTOS_MENU_TABLE = 'Produtosmenu';

const menuDb = new sqlite3.Database(
  MENU_DB_FILE,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (error) => {
    if (error) {
      console.error('Falha ao abrir o banco de dados Produtosmenu:', error);
      process.exit(1);
    }
  }
);

const ensureProdutosMenuTable = () =>
  new Promise((resolve, reject) => {
    const sql = `
      CREATE TABLE IF NOT EXISTS "${PRODUTOS_MENU_TABLE}" (
        table_name TEXT NOT NULL,
        product_name TEXT NOT NULL,
        price TEXT DEFAULT 'R$0',
        stock INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (table_name, product_name)
      )
    `;
    menuDb.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const persistProdutosMenuEntries = (tableName, products = []) =>
  new Promise((resolve, reject) => {
    if (!tableName || !products.length) {
      resolve();
      return;
    }
    const stmt = menuDb.prepare(
      `INSERT INTO "${PRODUTOS_MENU_TABLE}" (table_name, product_name, price, stock) VALUES (?, ?, 'R$0', 0) ON CONFLICT(table_name, product_name) DO UPDATE SET price = excluded.price, stock = excluded.stock`
    );
    let idx = 0;
    const execNext = () => {
      if (idx >= products.length) {
        stmt.finalize((finalError) => {
          if (finalError) {
            reject(finalError);
            return;
          }
          resolve();
        });
        return;
      }
      const product = products[idx];
      stmt.run(tableName, product, (error) => {
        if (error) {
          stmt.finalize(() => reject(error));
          return;
        }
        idx += 1;
        execNext();
      });
    };
    execNext();
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

const reserveStockItems = async (tableName, quantity, productName) => {
  if (!tableName || quantity <= 0) return [];
  if (productName) {
    const rows = await fetchProductKeyRows(tableName, productName, quantity);
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    await deleteProductKeyRows(tableName, productName, ids);
    return rows;
  }
  const rows = await fetchStockRows(tableName, quantity);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  await deleteStockRows(tableName, ids);
  return rows;
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

const getProdutosMenuEntries = (tableName) =>
  new Promise((resolve, reject) => {
    if (!tableName) {
      resolve([]);
      return;
    }
    const sql = `
      SELECT table_name, product_name, price, stock
      FROM "${PRODUTOS_MENU_TABLE}"
      WHERE table_name = ?
      ORDER BY rowid ASC
    `;
    menuDb.all(sql, [tableName], (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });

const fetchProdutosMenuTables = () =>
  new Promise((resolve, reject) => {
    const sql = `
      SELECT DISTINCT table_name
      FROM "${PRODUTOS_MENU_TABLE}"
      ORDER BY table_name ASC
    `;
    menuDb.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((rows || []).map((row) => row.table_name));
    });
  });

const updateProdutoMenuEntry = (tableName, productName, updates = {}) =>
  new Promise((resolve, reject) => {
    if (!tableName || !productName) {
      resolve();
      return;
    }
    const fields = [];
    const values = [];
    if (updates.price !== undefined) {
      fields.push('price = ?');
      values.push(updates.price);
    }
    if (updates.stock !== undefined) {
      fields.push('stock = ?');
      values.push(updates.stock);
    }
    if (!fields.length) {
      resolve();
      return;
    }
    const sql = `
      UPDATE "${PRODUTOS_MENU_TABLE}"
      SET ${fields.join(', ')}
      WHERE table_name = ? AND product_name = ?
    `;
    values.push(tableName, productName);
    menuDb.run(sql, values, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const getProductKeyTableName = (tableName, productName) => {
  const sanitized = sanitizeTableName(`${tableName}_${productName}`);
  if (!sanitized) return null;
  return `prod_keys_${sanitized}`;
};

const parseProductKeysInput = (input = '') =>
  (input || '')
    .split(/[\n\r,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const ensureProductKeyTable = (tableName, productName) =>
  new Promise((resolve, reject) => {
    const keyTable = getProductKeyTableName(tableName, productName);
    if (!keyTable) {
      resolve(null);
      return;
    }
    const sql = `
      CREATE TABLE IF NOT EXISTS "${keyTable}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;
    menuDb.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(keyTable);
    });
  });

const insertProductKeys = (tableName, productName, keys = []) =>
  new Promise((resolve, reject) => {
    if (!tableName || !productName || !keys.length) {
      resolve(0);
      return;
    }
    ensureProductKeyTable(tableName, productName)
      .then((keyTable) => {
        if (!keyTable) {
          resolve(0);
          return;
        }
        const stmt = menuDb.prepare(`INSERT INTO "${keyTable}" (key_text) VALUES (?)`);
        let inserted = 0;
        const queue = [...keys];
        const next = () => {
          if (!queue.length) {
            stmt.finalize((finalErr) => {
              if (finalErr) {
                reject(finalErr);
                return;
              }
              resolve(inserted);
            });
            return;
          }
          const key = queue.shift();
          stmt.run(key, function (error) {
            if (error) {
              stmt.finalize(() => reject(error));
              return;
            }
            inserted += this.changes || 0;
            next();
          });
        };
        next();
      })
      .catch(reject);
  });

const countProductKeys = async (tableName, productName) => {
  const keyTable = await ensureProductKeyTable(tableName, productName);
  if (!keyTable) {
    return 0;
  }
  return new Promise((resolve, reject) => {
    const sql = `SELECT COUNT(*) AS total FROM "${keyTable}"`;
    menuDb.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row?.total || 0);
    });
  });
};

const fetchProductKeyRows = async (tableName, productName, limit) => {
  if (!tableName || !productName || limit <= 0) {
    return [];
  }
  const keyTable = await ensureProductKeyTable(tableName, productName);
  if (!keyTable) {
    return [];
  }
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, key_text FROM "${keyTable}" ORDER BY id ASC LIMIT ?`;
    menuDb.all(sql, [limit], (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((rows || []).map((row) => ({ id: row.id, item: row.key_text })));
    });
  });
};

const deleteProductKeyRows = async (tableName, productName, ids = []) => {
  if (!tableName || !productName || !ids.length) {
    return;
  }
  const keyTable = await ensureProductKeyTable(tableName, productName);
  if (!keyTable) {
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM "${keyTable}" WHERE id IN (${placeholders})`;
    menuDb.run(sql, ids, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};
const getAllProdutosMenuEntries = () =>
  new Promise((resolve, reject) => {
    const sql = `
      SELECT table_name, product_name, price, stock
      FROM "${PRODUTOS_MENU_TABLE}"
      ORDER BY table_name ASC, rowid ASC
    `;
    menuDb.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
ensureProdutosMenuTable().catch((error) => {
  console.error('Erro ao garantir tabela Produtosmenu', error);
});
initPanelMetadataStorage();

const getPriceForTable = (tableName) => {
  if (priceOverrides.has(tableName)) {
    return priceOverrides.get(tableName);
  }
  const metadataList = panelMetadataByTable.get(tableName);
  const metadata = metadataList?.[0];
  return metadata?.session.price || '';
};

const buildStockEmbed = (tableName, stock, price) => {
  const priceLabel = price ? `💸 Preço: ${price}` : '💸 Preço: -';
  const stockLabel = Number.isFinite(stock) ? `📦 Estoque: ${stock}` : '📦 Estoque: -';
  return new EmbedBuilder()
    .setTitle(`Estoque: ${tableName}`)
    .setDescription(
      `${priceLabel}\n${stockLabel}\nUse os botões abaixo para adicionar ou limpar o estoque.`
    )
    .setColor('DarkGreen');
};


const closeDatabase = () => {
  if (!db) return;
  db.close((error) => {
    if (error) {
      console.error('Erro ao encerrar produtos.db:', error);
    }
  });
};

const closeMenuDatabase = () => {
  if (!menuDb) return;
  menuDb.close((error) => {
    if (error) {
      console.error('Erro ao encerrar produtosmenu.db:', error);
    }
  });
};

process.once('exit', () => {
  closeDatabase();
  closeMenuDatabase();
});
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.once(signal, () => {
    closeDatabase();
    closeMenuDatabase();
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
      const resolvedPrice = priceOverrides.get(tableName) || metadata.session.price;
      const embed = buildVendaEmbed(metadata.session, stock, tableName, resolvedPrice);
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
const saleMenuSessions = new Map();
const buttonSaleSessions = new Map();
const supportMenus = new Map();
const panelMetadataByTable = new Map();
const panelMetadataByMessageId = new Map();
const priceOverrides = new Map();
const stockMessagesByTable = new Map();
const orderSessions = new Map();
const paymentReferences = new Map();
const ORDER_INACTIVITY_MS = 10 * 60 * 1000;
const ORDER_APPROVAL_LOG_CHANNEL_ID = '1487287630797209661';

const normalizeColor = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return trimmed;
};

function clearOrderAutoCloseTimer(state) {
  if (!state?.autoCloseTimer) return;
  clearTimeout(state.autoCloseTimer);
  state.autoCloseTimer = null;
}

function scheduleOrderAutoClose(state) {
  if (!state || !state.channelId) return;
  clearOrderAutoCloseTimer(state);
  state.autoCloseTimer = setTimeout(async () => {
    const since = Date.now() - (state.lastActivityAt ?? 0);
    if (since < ORDER_INACTIVITY_MS) {
      scheduleOrderAutoClose(state);
      return;
    }
    try {
      const channel = await client.channels.fetch(state.channelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        const closingEmbed = new EmbedBuilder()
          .setTitle('Ticket encerrado por inatividade')
          .setDescription('Não houve mensagens nem interações por 10 minutos, então o ticket foi fechado automaticamente.')
          .setColor('Red');
        await channel.send({ embeds: [closingEmbed], allowedMentions: { repliedUser: false } });
        await channel.delete('Fechamento automático por inatividade');
      }
    } catch (error) {
      console.error('Erro ao fechar canal por inatividade', error);
    } finally {
      clearOrderAutoCloseTimer(state);
      if (state.channelId) {
        orderSessions.delete(state.channelId);
      }
    }
  }, ORDER_INACTIVITY_MS);
}

function markOrderActivity(state) {
  if (!state) return;
  state.lastActivityAt = Date.now();
  scheduleOrderAutoClose(state);
}

const RESPOND_EPHEMERAL_FLAGS = 1 << 6;
const respondEphemeral = async (interaction, content) => {
  if (!interaction) return null;
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, flags: RESPOND_EPHEMERAL_FLAGS });
  }
  return interaction.reply({ content, flags: RESPOND_EPHEMERAL_FLAGS });
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
    new ButtonBuilder().setCustomId('ticket:title').setLabel('Ttulo').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:description').setLabel('Descrio').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:image').setLabel('Imagem').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:supports').setLabel('Suportes').setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:color').setLabel('Cor da embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:send').setLabel('Enviar ticket').setStyle(ButtonStyle.Success)
  )
];

const createVendaMenuControlRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendamenu:title').setLabel('Título').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendamenu:description').setLabel('Descrição').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendamenu:products').setLabel('Produtos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendamenu:table').setLabel('Table').setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendamenu:image').setLabel('Imagem').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendamenu:color').setLabel('Cor da embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendamenu:send').setLabel('Enviar painel').setStyle(ButtonStyle.Success)
  )
];

const createVendaBotaoControlRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendabotao:title').setLabel('Ttulo').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendabotao:description').setLabel('Descrio').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vendabotao:image').setLabel('Imagem').setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendabotao:price').setLabel('Preo').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendabotao:color').setLabel('Cor da embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendabotao:dbname').setLabel('DB Name').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vendabotao:send').setLabel('Enviar painel').setStyle(ButtonStyle.Success)
  )
];

const createVendaBuyButtonRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vendabotao:comprar').setLabel('Comprar').setStyle(ButtonStyle.Success)
  );

const buildVendaEmbed = (session, stock = 0, tableName = null, tablePrice = null) => {
  const embed = new EmbedBuilder()
    .setTitle(session.title || 'Painel de venda')
    .setColor(session.color || '#5865F2');

  if (session.imageURL) {
    embed.setImage(session.imageURL);
  }

  const resolvedPrice = tablePrice ?? session.price ?? '';
  const stockLabel = Number.isFinite(stock) ? stock : '-';
  const descriptionParts = [];
  const cleanedDescription = session.description?.trim();
  if (cleanedDescription) {
    descriptionParts.push(cleanedDescription);
  }
  const overviewLine = `💸Preço: ${resolvedPrice || '-'} | 📦Estoque: ${stockLabel}`;
  descriptionParts.push(overviewLine);

  embed.setDescription(descriptionParts.join('\n\n').trim() || ' ');
  return embed;
};

const refreshVendaMenuEmbeds = async (tableName) => {
  const metadataList = panelMetadataByTable.get(tableName);
  if (!metadataList?.length) return;
  try {
    const productDetails = await getProdutosMenuEntries(tableName);
    for (const metadata of metadataList.slice()) {
      try {
        const channel = await client.channels.fetch(metadata.channelId);
        if (!channel?.isTextBased?.()) continue;
        const message = await channel.messages.fetch(metadata.messageId);
        const session = metadata.session || {};
        const embed = buildVendaMenuEmbed(session, productDetails);
        const menuRow = buildVendaMenuProductRow(session.products, productDetails);
        const components = menuRow ? [menuRow] : [];
        await message.edit({ embeds: [embed], components });
      } catch (error) {
        if (error?.code === 10008) {
          const remaining = panelMetadataByTable
            .get(tableName)
            ?.filter((item) => item.messageId !== metadata.messageId);
          if (remaining) {
            panelMetadataByTable.set(tableName, remaining);
          }
          panelMetadataByMessageId.delete(metadata.messageId);
          continue;
        }
        console.error('Erro atualizando painel de vendas', error);
      }
    }
  } catch (error) {
    console.error('Erro ao recarregar detalhes do painel de vendas', error);
  }
};

const buildVendaMenuEmbed = (session, productDetails = []) => {
  const embed = new EmbedBuilder()
    .setTitle(session.title || 'Painel de vendas')
    .setColor(session.color || '#5865F2');

  if (session.imageURL) {
    embed.setImage(session.imageURL);
  }

  const descriptionParts = [];
  const cleanedDescription = session.description?.trim();
  if (cleanedDescription) {
    descriptionParts.push(cleanedDescription);
  }
  if (session.tableName) {
    descriptionParts.push(`Tabela: \`${session.tableName}\``);
  }
  embed.setDescription(descriptionParts.join('\n\n').trim() || ' ');
  return embed;
};

const buildVendaMenuProductRow = (products = [], productDetails = []) => {
  if (!products.length) return null;
  const productMap = new Map((productDetails || []).map((detail) => [detail.product_name, detail]));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('vendamenu_products')
      .setPlaceholder('Selecione uma opção...')
      .addOptions(
        products.slice(0, 25).map((product) => ({
          label: product.slice(0, 100),
          value: product,
          description: `💸 | Preço: ${productMap.get(product)?.price || 'R$0'} 📦 | Estoque: ${
            productMap.get(product)?.stock ?? '0'
          }`.slice(0, 100)
        }))
      )
  );
};

const resetVendaMenuSelection = async (message, session, productDetails) => {
  if (!message?.edit) return;
  const newRow = buildVendaMenuProductRow(session?.products || [], productDetails);
  if (!newRow) return;
  try {
    await message.edit({ components: [newRow] });
  } catch (error) {
    console.error('Erro ao limpar seleção do menu de vendas', error);
  }
};

const buildEstoqueProductEmbed = (tableName, productName, price = 'R$0', stock = 0) =>
  new EmbedBuilder()
    .setTitle(`Controle: ${productName}`)
    .setDescription(`Tabela: \`${tableName}\``)
    .addFields(
      { name: '💸 Preço', value: price || 'R$0', inline: true },
      { name: '📦 Estoque', value: String(stock ?? 0), inline: true }
    )
    .setColor('Purple');

const buildEstoqueActionRow = (tableName, productName) => {
  const encodedTable = encodeURIComponent(tableName);
  const encodedProduct = encodeURIComponent(productName);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`addestoquemenu_btn:add:${encodedTable}:${encodedProduct}`)
      .setLabel('Adicionar estoque')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`addestoquemenu_btn:price:${encodedTable}:${encodedProduct}`)
      .setLabel('Alterar preço')
      .setStyle(ButtonStyle.Primary)
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
    console.error('Erro ao resolver estoque da sesso', error);
    return { tableKey, stock: 0 };
  }
};

const resolveOrderStock = async (state) => {
  if (!state?.tableName) return 0;
  if (state.productName) {
    try {
      return await countProductKeys(state.tableName, state.productName);
    } catch (error) {
      console.error('Erro ao contar estoque do produto', error);
      return 0;
    }
  }
  try {
    return await getStockCount(state.tableName);
  } catch (error) {
    console.error('Erro ao contar estoque da tabela', error);
    return 0;
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

const formatRelativeTime = (start, end) => {
  const delta = Math.round((end - start) / 1000);
  if (delta < 60) return 'há segundos';
  if (delta < 3600) {
    const minutes = Math.floor(delta / 60);
    return `há ${minutes} minuto${minutes > 1 ? 's' : ''}`;
  }
  if (delta < 86400) {
    const hours = Math.floor(delta / 3600);
    return `há ${hours} hora${hours > 1 ? 's' : ''}`;
  }
  const days = Math.floor(delta / 86400);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
};

const buildOrderProductSummary = (state, reservedItems) => {
  const summaryMap = new Map();
  if (state?.productName) {
    const qty = Number.isFinite(state.quantity) && state.quantity > 0 ? state.quantity : reservedItems?.length || 1;
    summaryMap.set(state.productName, (summaryMap.get(state.productName) || 0) + qty);
  } else if (reservedItems?.length) {
    for (const row of reservedItems) {
      const label = String(row?.item || 'Produto').trim() || 'Produto';
      summaryMap.set(label, (summaryMap.get(label) || 0) + 1);
    }
  } else {
    const titleLabel = state?.title || 'Produto';
    summaryMap.set(titleLabel, Number.isFinite(state?.quantity) && state.quantity > 0 ? state.quantity : 1);
  }
  return Array.from(summaryMap.entries()).map(([label, qty]) => `${qty}x ${label}`);
};

const sendOrderApprovalLog = async (state, reservedItems, total, eventTime = new Date()) => {
  try {
    const channel = await client.channels.fetch(ORDER_APPROVAL_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const dayName = eventTime.toLocaleDateString('pt-BR', { weekday: 'long' });
    const datePart = eventTime.toLocaleDateString('pt-BR');
    const timePart = eventTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const relative = formatRelativeTime(eventTime.getTime(), Date.now());
    const productLines = buildOrderProductSummary(state, reservedItems);
    const description = [
      '👤 | Cliente:',
      `${state.userTag || 'Desconhecido'} (${state.userId || '0'})`,
      '🤑 | Produtos:',
      productLines.length ? productLines.map((line) => `- ${line}`).join('\n') : '- Sem produtos registrados',
      '💳 | Total pago:',
      `${formatCurrencyValue(total) || 'R$0,00'}`,
      '📅 | Data & Hora:',
      `- ${dayName} - ${datePart} - ${timePart} (${relative})`
    ].join('\n');
    const embed = new EmbedBuilder()
      .setTitle('VgN | Compra aprovada!')
      .setDescription(description)
      .setColor(0x2d8c00);
    await channel.send({ embeds: [embed], allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error('Erro ao registrar compra aprovada no canal', error);
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
      { name: 'Preo unitário', value: state.priceLabel || '', inline: true },
      { name: 'Quantidade escolhida', value: String(quantity), inline: true },
      { name: 'Estoque disponvel', value: String(stock), inline: true },
      { name: 'Total aproximado', value: formatCurrencyValue(total), inline: true },
      { name: 'Cupom aplicado', value: state.coupon || 'Nenhum', inline: true }
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
    .setTitle('Confirmao de pagamento')
    .setDescription('Revise a quantidade e o total antes de gerar o PIX.')
    .setColor('#2d8c00')
    .addFields(
      { name: 'Produto', value: state.title || 'Pedido', inline: true },
      { name: 'Quantidade', value: String(Number.isFinite(state.quantity) ? state.quantity : 1), inline: true },
      { name: 'Total', value: formatCurrencyValue(total), inline: true },
      { name: 'Preo unitário', value: state.priceLabel || '', inline: true }
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
  if (!guild) throw new Error('Guild no encontrada.');
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
        name: 'Instrues',
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
    console.error('Falha ao enviar webhook de confirmao de pagamento', error);
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
  if (!reference) return;
  const entry = paymentReferences.get(reference);
  if (!entry || entry.processing) return;
  entry.processing = true;
  try {
    const state = entry.state;
    const total = calculateOrderTotal(state);
    const reservedItems = await reserveStockItems(state.tableName, state.quantity, state.productName);
    const itemList = reservedItems.map((row) => row.item || `item-${row.id}`);
    state.paymentProcessed = true;
    entry.processed = true;
    paymentReferences.delete(reference);

    const dmEmbed = new EmbedBuilder()
      .setTitle('Pagamento confirmado')
      .setDescription('Recebemos a confirmao do PIX e reservamos seus itens.')
      .setColor('#2d8c00')
      .addFields(
        { name: 'Produto', value: state.title || 'Pedido', inline: true },
        { name: 'Quantidade', value: String(state.quantity), inline: true },
        { name: 'Valor total', value: formatCurrencyValue(total), inline: true },
        { name: 'Tabela', value: state.tableName || '', inline: true }
      );
    try {
      const buyer = await client.users.fetch(state.userId);
      const productSummary = buildOrderProductSummary(state, reservedItems);
      await buyer.send({ embeds: [dmEmbed] });
      if (productSummary.length) {
        await buyer.send({
          content: ['Produtos:', ...productSummary.map((line) => `- ${line}`)].join('\n'),
          allowedMentions: { repliedUser: false }
        });
      }
    } catch (error) {
      console.error('Erro ao enviar DM de confirmao', error);
    }

    try {
      const orderChannel = await client.channels.fetch(state.channelId).catch(() => null);
      if (orderChannel?.isTextBased?.()) {
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
      const remainingStock = await resolveOrderStock(state);
      state.stock = remainingStock;
      if (state.productName) {
        try {
          await updateProdutoMenuEntry(state.tableName, state.productName, { stock: remainingStock });
          await refreshVendaMenuEmbeds(state.tableName);
        } catch (updateError) {
          console.error('Erro ao atualizar painel de vendas apos confirmao', updateError);
        }
      }
      await updateOrderMessageEmbed(state);
    } catch (error) {
      console.error('Erro ao atualizar embed de estoque aps confirmao', error);
    }

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
    const eventTime = paymentInfo?.date_approved
      ? new Date(paymentInfo.date_approved)
      : paymentInfo?.date_created
      ? new Date(paymentInfo.date_created)
      : new Date();
    await sendOrderApprovalLog(state, reservedItems, total, eventTime);
  } catch (error) {
    console.error('Erro ao processar confirmao de pagamento', error);
  }
};

const handleMercadoPagoWebhook = async (payload) => {
  const paymentId = payload?.data?.id || payload?.id;
  if (!paymentId) {
    return;
  }
  try {
    const paymentInfo = await fetchMercadoPagoPaymentDetails(paymentId);
    await processPaymentConfirmation(paymentInfo);
  } catch (error) {
    console.error('Erro tratando webhook do Mercado Pago', error);
  }
};

const startMercadoPagoWebhookServer = () => {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/mercadopago/webhook')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const rawBody = await collectRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : null;
      handleMercadoPagoWebhook(payload);
      res.writeHead(200);
      res.end('OK');
    } catch (error) {
      console.error('Falha ao ler webhook do Mercado Pago', error);
      res.writeHead(400);
      res.end('Bad request');
    }
  });

  server.on('error', (error) => {
    console.error('Erro no servidor de webhook do Mercado Pago', error);
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`Webhook Mercado Pago ouvindo em http://localhost:${WEBHOOK_PORT}/mercadopago/webhook`);
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
    throw new Error('Token do Mercado Pago no configurado.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Valor invlido para gerar o PIX.');
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
    external_reference: reference
  };
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
  if (!response.ok) {
    const message = result?.message || 'No foi possvel gerar o PIX.';
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
    .setDescription(session.description || 'Sem descrio definida.')
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
    description: 'Inicia a criao interativa de um ticket.',
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
          'Use os botes abaixo para definir ttulo, descrio, imagem, suportes e cor. Clique em "Enviar ticket" quando finalizar.'
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
    description: 'Inicia a configuração interativa do menu de vendas.',
    async execute(message) {
      saleMenuSessions.set(message.author.id, {
        title: '',
        description: '',
        imageURL: null,
        products: [],
        tableName: '',
        color: '#5865F2'
      });

      const embed = new EmbedBuilder()
        .setTitle('Configuração do painel de vendas')
        .setDescription(
          'Use os botões abaixo para preencher título, descrição, produtos, nome da tabela, imagem e cor. Clique em "Enviar painel" ao terminar.'
        )
        .setColor('Purple');

      await message.reply({
        embeds: [embed],
        components: createVendaMenuControlRows(),
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
          'Defina ttulo, descrio, imagem, preo, cor e nome da tabela. Clique em "Enviar painel" quando terminar.'
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
    description: 'Exibe um catlogo de exemplo para vendas.',
    async execute(message) {
      await message.reply({
        content:
          'Catlogo de exemplo:\n1. Camiseta PRO - R$ 120\n2. Curso Intensivo - R$ 350\nAbra um ticket para pedir apoio.',
        allowedMentions: { repliedUser: false }
      });
    }
  },
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
  },
  addestoquemenu: {
    description: 'Abre o painel rápido para alterar preço ou adicionar estoque aos produtos.',
    async execute(message) {
      try {
        const entries = await getAllProdutosMenuEntries();
        if (!entries.length) {
          await message.reply({
            content: 'Nenhum painel de vendas encontrado. Crie um com .vendamenu primeiro.',
            allowedMentions: { repliedUser: false }
          });
          return;
        }
        const options = entries.slice(0, 25).map((entry) => ({
          label: `${entry.table_name} / ${entry.product_name}`.slice(0, 100),
          value: `${entry.table_name}::${entry.product_name}`,
          description: `Preço ${entry.price || 'R$0'} • Estoque ${entry.stock ?? 0}`.slice(0, 100)
        }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('addestoquemenu_select')
            .setPlaceholder('Selecione o produto para ajustar')
            .addOptions(options)
        );
        const embed = new EmbedBuilder()
          .setTitle('Menu de estoque')
          .setDescription('Escolha um produto para adicionar chaves ou alterar o preço.')
          .setColor('DarkGreen');
        await message.reply({
          embeds: [embed],
          components: [row],
          allowedMentions: { repliedUser: false }
        });
      } catch (error) {
        console.error('Erro abrindo o menu de estoque', error);
        await message.reply({
          content: 'Não foi possível abrir o menu de estoque no momento.',
          allowedMentions: { repliedUser: false }
        });
      }
    }
  }
};
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  const openOrderState = orderSessions.get(message.channel.id);
  if (openOrderState) {
    markOrderActivity(openOrderState);
  }
  if (!message.content.startsWith(PREFIX)) return;

  const [comando, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  if (!comando) return;

  const registro = commands[comando.toLowerCase()];
  if (!registro) return;

  const member = message.member;
  if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
    await message.reply({
      content: `Voc precisa ter o cargo <@&${COMMAND_ROLE_ID}> para usar comandos.`,
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
        await interaction.deferUpdate().catch(() => null);
        const selection = interaction.values[0];
        if (!selection) {
          await respondEphemeral(interaction, 'Selecione um produto válido.');
          return;
        }
        const panelMetadata = panelMetadataByMessageId.get(interaction.message?.id);
        const metadata = panelMetadata?.entry?.session;
        const tableName = panelMetadata?.tableName;
        if (!tableName) {
          await respondEphemeral(interaction, 'Este painel não está vinculado a uma tabela.');
          return;
        }
        const productDetails = await getProdutosMenuEntries(tableName);
        await resetVendaMenuSelection(interaction.message, metadata?.session, productDetails);
        const matched = productDetails.find((detail) => detail.product_name === selection);
        const priceLabel = matched?.price || 'R$0';
        const priceNumber = parsePriceNumber(priceLabel);
        await ensureProductTable(tableName);
        const availableStock = await countProductKeys(tableName, selection);
        if (availableStock <= 0) {
          await respondEphemeral(interaction, 'Estoque indisponível no momento.');
          return;
        }
        const guild = interaction.guild;
        if (!guild) {
          await respondEphemeral(interaction, 'Falha ao abrir o pedido. Tente novamente.');
          return;
        }
        const requester = sanitizeChannelName(interaction.user.username) || 'cliente';
        const channelName = `pedido-${requester}-${interaction.user.id}`.slice(0, 90);
        try {
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
          const orderState = {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            tableName,
            priceLabel,
            priceNumber,
            title: selection,
            description: metadata?.description || matched?.notes || '',
            imageURL: metadata?.imageURL || '',
            color: metadata?.color || '#5865F2',
            stock: availableStock,
            productName: selection,
            quantity: 1,
            coupon: null
          };
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
          markOrderActivity(orderState);
          await sendWebhookNotification(WEBHOOKS.orderCreate, {
            title: 'Canal de compra aberto',
            description: `${interaction.user.tag} criou ${channel.name}`,
            color: 0x2d8c00,
            fields: [
              { name: 'Produto', value: orderState.title || '', inline: true },
              { name: 'Estoque atual', value: String(availableStock), inline: true },
              { name: 'Canal', value: `<#${channel.id}>`, inline: true }
            ],
            timestamp: new Date().toISOString()
          });
          await respondEphemeral(interaction, `Canal criado: <#${channel.id}>. Acompanhe por lá.`);
          await resetVendaMenuSelection(interaction.message, metadata.session, productDetails);
        } catch (error) {
          console.error('Erro criando canal via menu de vendas', error);
          await respondEphemeral(interaction, 'Não foi possível criar o canal de pedido.');
        }
        return;
      }
      if (interaction.customId === 'addestoquemenu_select') {
        const selection = interaction.values[0];
        if (!selection) {
          await respondEphemeral(interaction, 'Selecione um produto válido.');
          return;
        }
        const [tableName, productName] = selection.split('::');
        if (!tableName || !productName) {
          await respondEphemeral(interaction, 'Seleção inválida.');
          return;
        }
        try {
          const entries = await getProdutosMenuEntries(tableName);
          const matched = entries.find((entry) => entry.product_name === productName);
          const embed = buildEstoqueProductEmbed(
            tableName,
            productName,
            matched?.price || 'R$0',
            matched?.stock ?? 0
          );
          const row = buildEstoqueActionRow(tableName, productName);
          await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
          });
        } catch (error) {
          console.error('Erro abrindo controle de produto', error);
          await respondEphemeral(interaction, 'Não foi possível abrir o produto selecionado.');
        }
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
          await respondEphemeral(interaction, 'Nome invlido do produto selecionado.');
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
              .setLabel('Alterar preo')
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
            fetchReply: true
          });
          if (replyMessage?.id) {
            stockMessagesByTable.set(sanitizedName, replyMessage.id);
          }
        } catch (error) {
          console.error('Erro ao montar embed de estoque', error);
          await respondEphemeral(interaction, 'No foi possvel carregar o produto selecionado.');
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
            await respondEphemeral(interaction, 'No foi possvel criar o canal de suporte. Verifique permisses e categoria.');
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
          await respondEphemeral(interaction, 'Sesso de pedido no encontrada.');
          return;
        }
        const requestedValue = interaction.fields.getTextInputValue('order_qty_input');
        let requested = Number.parseInt(requestedValue?.trim(), 10);
        if (!Number.isFinite(requested) || requested < 1) {
          requested = 1;
        }
        const stock = await resolveOrderStock(state);
        state.stock = stock;
        if (stock <= 0) {
          state.quantity = 0;
          await updateOrderMessageEmbed(state);
          await interaction.reply({ content: 'Estoque indisponvel.', ephemeral: true });
          return;
        }
        state.quantity = Math.min(stock, requested);
        await updateOrderMessageEmbed(state);
        await interaction.reply({ content: `Quantidade definida para ${state.quantity}.`, ephemeral: true });
        return;
      }

      if (interaction.customId === 'order_coupon_modal') {
        const state = orderSessions.get(interaction.channelId);
        if (!state) {
          await respondEphemeral(interaction, 'Sesso de pedido no encontrada.');
          return;
        }
        const couponCode = interaction.fields.getTextInputValue('order_coupon_input')?.trim();
        state.coupon = couponCode || null;
        await updateOrderMessageEmbed(state);
        await interaction.reply({
          content: couponCode ? `Cupom definido: ${couponCode}` : 'Cupom limpo.',
          ephemeral: true
        });
        return;
      }
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('addestoquemenu_btn:')) {
      await interaction.deferReply({ ephemeral: true });
      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await interaction.editReply({
          content: `Você precisa do cargo <@&${COMMAND_ROLE_ID}> para usar esse menu.`
        });
        return;
      }
      const parts = interaction.customId.split(':');
      const action = parts[1];
      const tableName = decodeURIComponent(parts[2] || '');
      const productName = decodeURIComponent(parts[3] || '');
      if (!tableName || !productName) {
        await interaction.editReply({ content: 'Produto inválido.' });
        return;
      }
      try {
        if (action === 'add') {
          const resposta = await awaitUserResponse(
            interaction,
            'Envie as chaves separadas por vírgula ou nova linha (ex: key1,key2). Cada chave aumenta o estoque.'
          );
          if (!resposta) return;
          const keys = parseProductKeysInput(resposta.content || '');
          if (!keys.length) {
            await interaction.editReply({ content: 'Nenhuma chave válida informada.' });
            return;
          }
          const inserted = await insertProductKeys(tableName, productName, keys);
          const total = await countProductKeys(tableName, productName);
          await updateProdutoMenuEntry(tableName, productName, { stock: total });
          await refreshVendaMenuEmbeds(tableName);
          await interaction.editReply({
            content: `Adicionados ${inserted} códigos. Estoque atualizado: ${total}.`
          });
          return;
        }
        if (action === 'price') {
          const resposta = await awaitUserResponse(interaction, 'Informe o preço exibido para o produto.');
          if (!resposta) return;
          const texto = resposta.content?.trim();
          if (!texto) {
            await interaction.editReply({ content: 'Informe um preço válido.' });
            return;
          }
          await updateProdutoMenuEntry(tableName, productName, { price: texto });
          await refreshVendaMenuEmbeds(tableName);
          await interaction.editReply({ content: `Preço atualizado para ${texto}.` });
          return;
        }
      } catch (error) {
        console.error('Erro no menu de estoque', error);
        await interaction.editReply({ content: 'Não foi possível concluir a operação.' });
      }
      return;
    }

    if (interaction.customId.startsWith('vendamenu:')) {
      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await respondEphemeral(interaction, `Você precisa do cargo <@&${COMMAND_ROLE_ID}> para configurar o painel.`);
        return;
      }

      const action = interaction.customId.split(':')[1];
      const session = saleMenuSessions.get(interaction.user.id);
      if (!session) {
        await respondEphemeral(interaction, 'Nenhuma sessão encontrada. Inicie o comando novamente.');
        return;
      }

      const promptForValue = async (texto) => {
        const response = await awaitUserResponse(interaction, texto);
        return response?.content?.trim();
      };

      if (action === 'title') {
        const texto = await promptForValue('Defina o título da embed.');
        if (texto) {
          session.title = texto;
          saleMenuSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Título atualizado.');
        }
        return;
      }

      if (action === 'description') {
        const texto = await promptForValue('Defina a descrição da embed.');
        if (texto) {
          session.description = texto;
          saleMenuSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Descrição atualizada.');
        }
        return;
      }

      if (action === 'products') {
        const texto = await promptForValue('Informe os produtos separados por vírgula.');
        if (!texto) {
          return;
        }
        const parsedProducts = texto
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 25);
        if (!parsedProducts.length) {
          await respondEphemeral(interaction, 'Nenhum produto válido informado.');
          return;
        }
        session.products = parsedProducts;
        saleMenuSessions.set(interaction.user.id, session);
        await respondEphemeral(interaction, 'Produtos registrados.');
        return;
      }

      if (action === 'table') {
        const texto = await promptForValue('Defina o nome da tabela dos produtos.');
        if (!texto) {
          return;
        }
        const sanitized = sanitizeTableName(texto);
        if (!sanitized) {
          await respondEphemeral(interaction, 'Nome da tabela inválido. Use letras, números e underline.');
          return;
        }
        session.tableName = sanitized;
        saleMenuSessions.set(interaction.user.id, session);
        await respondEphemeral(interaction, `Tabela definida: ${sanitized}`);
        return;
      }

      if (action === 'image') {
        const resposta = await awaitUserResponse(interaction, 'Envie uma URL de imagem ou digite "remover" para limpar.');
        if (!resposta) return;
        const attachment = resposta.attachments.first();
        if (attachment) {
          session.imageURL = attachment.url;
        } else {
          const texto = resposta.content?.trim();
          if (!texto) return;
          if (texto.toLowerCase() === 'remover') {
            session.imageURL = null;
          } else {
            session.imageURL = texto;
          }
        }
        saleMenuSessions.set(interaction.user.id, session);
        await respondEphemeral(interaction, 'Imagem atualizada.');
        return;
      }

      if (action === 'color') {
        const texto = await promptForValue('Informe uma cor válida (ex: #ff8800).');
        if (!texto) {
          return;
        }
        const color = normalizeColor(texto);
        if (color) {
          session.color = color;
          saleMenuSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Cor atualizada.');
        } else {
          await respondEphemeral(interaction, 'Cor inválida. Use #rrggbb ou um nome válido.');
        }
        return;
      }

      if (action === 'send') {
        if (!session.tableName) {
          await respondEphemeral(interaction, 'Defina o nome da tabela antes de enviar.');
          return;
        }
        if (!session.products?.length) {
          await respondEphemeral(interaction, 'Informe ao menos um produto.');
          return;
        }
        await ensureProductTable(session.tableName);
        await persistProdutosMenuEntries(session.tableName, session.products);
        const productDetails = await getProdutosMenuEntries(session.tableName);
        const embed = buildVendaMenuEmbed(session, productDetails);
        const menuRow = buildVendaMenuProductRow(session.products, productDetails);
        await respondEphemeral(interaction, 'Painel pronto! Está sendo publicado.');
        const sent = await interaction.channel.send({
          embeds: [embed],
          components: menuRow ? [menuRow] : [],
          allowedMentions: { repliedUser: false }
        });
        if (sent) {
          const metadataEntry = {
            channelId: interaction.channel.id,
            messageId: sent.id,
            session: {
              title: session.title,
              description: session.description,
              imageURL: session.imageURL,
              color: session.color,
              products: session.products,
              tableName: session.tableName
            }
          };
          registerPanelMetadata(session.tableName, metadataEntry);
        }
        await refreshVendaMenuEmbeds(session.tableName);
        saleMenuSessions.delete(interaction.user.id);
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
          await respondEphemeral(interaction, 'Produto no est vinculado a uma tabela, contate a equipe.');
          return;
        }
        const stock = await getStockCount(tableName);
        if (stock <= 0) {
          await respondEphemeral(interaction, 'Estoque indisponvel no momento.');
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
        markOrderActivity(orderState);
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
        await respondEphemeral(interaction, `Voc precisa do cargo <@&${COMMAND_ROLE_ID}> para configurar o painel.`);
        return;
      }

      const session = buttonSaleSessions.get(interaction.user.id);
      if (!session) {
        await respondEphemeral(interaction, 'Nenhuma sesso encontrada. Inicie o comando novamente.');
        return;
      }

      const promptForValue = async (texto) => {
        const response = await awaitUserResponse(interaction, texto);
        return response?.content?.trim();
      };

      if (action === 'title') {
        const texto = await promptForValue('Defina o ttulo do painel.');
        if (texto) {
          session.title = texto;
          buttonSaleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Ttulo atualizado.');
        }
        return;
      }

      if (action === 'description') {
        const texto = await promptForValue('Defina a descrio do painel.');
        if (texto) {
          session.description = texto;
          buttonSaleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Descrio atualizada.');
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
        const texto = await promptForValue('Informe o preo que ser exibido (ex: R$ 120).');
        if (texto) {
          session.price = texto;
          buttonSaleSessions.set(interaction.user.id, session);
          await respondEphemeral(interaction, 'Preo atualizado.');
        }
        return;
      }

      if (action === 'color') {
        const texto = await promptForValue('Informe um cdigo de cor em hexadecimal (ex: #ff8800) ou nome.');
        if (texto) {
          const color = normalizeColor(texto);
          if (color) {
            session.color = color;
            buttonSaleSessions.set(interaction.user.id, session);
            await respondEphemeral(interaction, 'Cor atualizada.');
          } else {
            await respondEphemeral(interaction, 'Cor invlida. Use #rrggbb ou um nome vlido.');
          }
        }
        return;
      }

      if (action === 'dbname') {
        const texto = await promptForValue('Defina o nome da tabela (dbname).');
        if (texto) {
          const sanitized = sanitizeTableName(texto);
          if (!sanitized) {
            await respondEphemeral(interaction, 'Nome invlido. Use apenas letras, nmeros e underline.');
            return;
          }
          try {
            await ensureProductTable(sanitized);
            session.dbname = sanitized;
            buttonSaleSessions.set(interaction.user.id, session);
            await respondEphemeral(interaction, `Tabela "${sanitized}" criada/confirmada.`);
          } catch (error) {
            console.error('Erro criando tabela no SQLite', error);
            await respondEphemeral(interaction, 'No foi possvel criar a tabela no banco de dados.');
          }
        }
        return;
      }

      if (action === 'send') {
        const { tableKey, stock } = await resolveSessionTableStock(session);
        const embed = buildVendaEmbed(session, stock, tableKey, session.price);
        const row = createVendaBuyButtonRow();
        await respondEphemeral(interaction, 'Painel pronto! Est sendo publicado.');
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
        await respondEphemeral(interaction, 'Sesso de pedido encerrada ou invlida.');
        return;
      }

      markOrderActivity(state);

      const stock = await resolveOrderStock(state);
      state.stock = stock;

      if (action === 'add') {
        if (stock <= 0) {
          await respondEphemeral(interaction, 'Estoque esgotado.');
          return;
        }
        if (state.quantity >= stock) {
          await respondEphemeral(interaction, 'Quantidade j atingiu o limite do estoque.');
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
          paymentReferences.set(reference, { state, processed: false });
          orderSessions.set(interaction.channelId, state);
          await respondEphemeral(interaction, 'PIX gerado! O QR Code e o cdigo aparecem abaixo.');
        } catch (error) {
          console.error('Erro ao gerar PIX', error);
          await respondEphemeral(interaction, `No foi possvel gerar o PIX. ${error.message || ''}`.trim());
        }
        return;
      }

      if (action === 'copy_pix') {
        const pixCode = state.pixData?.qrCode;
        if (!pixCode) {
          await respondEphemeral(interaction, 'Ainda no h PIX gerado para copiar.');
          return;
        }
        await respondEphemeral(interaction, `Cdigo PIX:\n\`\`\`${pixCode}\`\`\``);
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
        clearOrderAutoCloseTimer(state);
        orderSessions.delete(interaction.channelId);
        return;
      }
    }

    if (interaction.customId.startsWith('stock:')) {
      const member = interaction.member;
      if (!member?.roles.cache.has(COMMAND_ROLE_ID)) {
        await respondEphemeral(interaction, `Voc precisa do cargo <@&${COMMAND_ROLE_ID}> para mexer no estoque.`);
        return;
      }

      const parts = interaction.customId.split(':');
      const action = parts[1];
      const tableName = parts.slice(2).join(':');
      const sanitizedName = sanitizeTableName(tableName);
      if (!sanitizedName) {
        await respondEphemeral(interaction, 'Nome de tabela invlido.');
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
          await respondEphemeral(interaction, 'Nenhum valor vlido informado.');
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
          await respondEphemeral(interaction, 'No foi possvel adicionar o estoque.');
        }
        return;
      }

      if (action === 'price') {
        const resposta = await awaitUserResponse(interaction, 'Informe o preo exibido no painel (ex: R$ 120).');
        if (!resposta) return;
        const valor = resposta.content?.trim();
        if (!valor) {
          await respondEphemeral(interaction, 'Informe um preo vlido.');
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
          await respondEphemeral(interaction, `Preo atualizado para ${valor}. Estoque atual: ${total}.`);
        } catch (error) {
          console.error('Erro ao atualizar preo', error);
          await respondEphemeral(interaction, 'No foi possvel atualizar o preo.');
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
          await respondEphemeral(interaction, 'No foi possvel limpar o estoque.');
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
            .setDescription(`A tabela **${sanitizedName}** foi excluda do banco de dados.`)
            .setColor('Red');
          if (interaction.message?.edit) {
            await interaction.message.edit({ embeds: [dropEmbed], components: [] });
          }
          await respondEphemeral(interaction, 'Tabela excluda. O estoque foi zerado e a tabela removida.');
        } catch (error) {
          console.error('Erro ao excluir tabela', error);
          await respondEphemeral(interaction, 'No foi possvel excluir a tabela.');
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
        await respondEphemeral(interaction, 'Canal invlido.');
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
              .setDescription('Ningum mais pode enviar mensagens nesta conversa at que um autorizado reabra.')
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
        await interaction.channel.delete('Ticket excludo via boto');
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
        await respondEphemeral(interaction, `Voc precisa do cargo <@&${COMMAND_ROLE_ID}> para manipular tickets.`);
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
        title: 'Qual ser o ttulo do ticket?',
        description: 'Escreva uma descrio para o ticket.',
        image: 'Cole uma URL de imagem ou envie um arquivo (digite "remover" para limpar).',
        supports: 'Liste os nomes das opes de suporte separados por vrgula.',
        color: 'Informe um cdigo hexadecimal (ex: #ff8800) ou um nome de cor.'
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
          await respondEphemeral(interaction, 'Informe um texto vlido.');
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
      await respondEphemeral(interaction, 'Ocorreu um erro ao processar a interao.');
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
