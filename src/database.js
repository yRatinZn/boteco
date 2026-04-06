const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'Produtos1.db');
const db = new sqlite3.Database(dbPath, (error) => {
  if (error) {
    console.error('Não foi possível abrir a base de dados Produtos1:', error);
  }
});

const panel2DbPath = path.join(__dirname, '..', 'Produtos2.db');
const panel2Db = new sqlite3.Database(panel2DbPath, (error) => {
  if (error) {
    console.error('Não foi possível abrir a base de dados Produtos2:', error);
  }
});

const META_PREFIX = '__meta__';
const META_STOCK = -1;

const sanitizeTableName = (value) => {
  if (!value || typeof value !== 'string') {
    return 'Produtos';
  }
  let name = value.trim();
  if (!name.length) {
    return 'Produtos';
  }
  name = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(name)) {
    name = `T${name}`;
  }
  return name;
};

const metaNameFor = (productName) => {
  const cleaned = productName && typeof productName === 'string' ? productName.trim() : 'Produto';
  const safeName = cleaned.length ? cleaned : 'Produto';
  return `${META_PREFIX}${safeName}`;
};

const stripMetaName = (value) => {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith(META_PREFIX)) {
    return value.slice(META_PREFIX.length);
  }
  return value;
};

const ensureTableForDb = (database, name) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, preco REAL, estoque INTEGER)`;
    database.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(tableName);
    });
  });

const insertProductForDb = (database, name, produto) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `INSERT INTO ${tableName} (nome, preco, estoque) VALUES (?, ?, ?)`;
    database.run(sql, [produto.nome, produto.preco, produto.estoque], function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.lastID);
    });
  });

const updateProductForDb = (database, name, data) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    if (!data || !data.id) {
      reject(new Error('O campo id é obrigatório para atualizar o produto.'));
      return;
    }
    const fields = { ...data };
    const id = fields.id;
    delete fields.id;
    const columns = Object.keys(fields);
    if (!columns.length) {
      resolve(0);
      return;
    }
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    const values = columns.map((column) => fields[column]);
    values.push(id);
    const sql = `UPDATE ${tableName} SET ${assignments} WHERE id = ?`;
    database.run(sql, values, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.changes);
    });
  });

const ensureTable = (name) => ensureTableForDb(db, name);
const ensurePanel2Table = (name) => ensureTableForDb(panel2Db, name);
const insertProduct = (name, produto) => insertProductForDb(db, name, produto);
const updateProduct = (name, data) => updateProductForDb(db, name, data);
const updateProductPanel2 = (name, data) => updateProductForDb(panel2Db, name, data);

const listUserTables = () =>
  new Promise((resolve, reject) => {
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'product_keys'";
    db.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows.map((row) => row.name));
    });
  });

const listTablesFromDb = (database) =>
  new Promise((resolve, reject) => {
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'product_keys'";
    database.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows.map((row) => row.name));
    });
  });

const listPanel2Tables = () => listTablesFromDb(panel2Db);

const getMetaRowForDb = (database, name, metaName) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const comparator = metaName ? 'nome = ?' : 'nome LIKE ?';
    const param = metaName ? metaName : `${META_PREFIX}%`;
    const sql = `SELECT id, nome, preco, estoque FROM ${tableName} WHERE ${comparator} LIMIT 1`;
    database.get(sql, [param], (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });

const ensureMetaRowForDb = async (database, name, productName, price, stockValue = META_STOCK) => {
  const tableName = await ensureTableForDb(database, name);
  const metaName = metaNameFor(productName);
  let meta = await getMetaRowForDb(database, tableName, metaName).catch(() => null);
  if (!meta) {
    meta = await getMetaRowForDb(database, tableName).catch(() => null);
  }
  if (meta) {
    await updateProductForDb(database, tableName, { id: meta.id, nome: metaName, preco: price, estoque: stockValue });
    return { ...meta, nome: metaName, preco: price, estoque: stockValue };
  }
  const id = await insertProductForDb(database, tableName, { nome: metaName, preco: price, estoque: stockValue });
  return { id, nome: metaName, preco: price, estoque: stockValue };
};

const getMetaRow = (name, metaName) => getMetaRowForDb(db, name, metaName);
const ensureMetaRow = (name, productName, price) => ensureMetaRowForDb(db, name, productName, price, META_STOCK);
const ensurePanel2MetaRow = (name, productName, price) => ensureMetaRowForDb(panel2Db, name, productName, price, 0);

const countStockRowsForDb = (database, name) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `SELECT COUNT(1) AS total FROM ${tableName} WHERE estoque > 0`;
    database.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row?.total ?? 0);
    });
  });

const countStockRows = (name) => countStockRowsForDb(db, name);
const countPanel2StockRows = (name) => countStockRowsForDb(panel2Db, name);

const getRepresentativeRowForDb = (database, name) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `SELECT id, nome, preco, estoque FROM ${tableName} WHERE estoque >= 0 ORDER BY estoque DESC LIMIT 1`;
    database.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });

const getRepresentativeRow = (name) => getRepresentativeRowForDb(db, name);

const getProductMetadataFromDb = async (database, name) => {
  const tableName = sanitizeTableName(name);
  const meta = await getMetaRowForDb(database, tableName).catch(() => null);
  if (meta) {
    const stock = await countStockRowsForDb(database, tableName).catch(() => 0);
    return { row: meta, isMeta: true, stock };
  }
  const representative = await getRepresentativeRowForDb(database, tableName).catch(() => null);
  if (representative) {
    const stock = await countStockRowsForDb(database, tableName).catch(() => 0);
    return { row: representative, isMeta: false, stock };
  }
  return null;
};

const getProductMetadata = (name, database = db) => getProductMetadataFromDb(database, name);
const getPanel2ProductMetadata = (name) => getProductMetadataFromDb(panel2Db, name);
const PIX_ORDERS_TABLE = 'pix_orders';

const ensurePixOrdersTable = () =>
  new Promise((resolve, reject) => {
    const sql = `CREATE TABLE IF NOT EXISTS ${PIX_ORDERS_TABLE} (
      id TEXT PRIMARY KEY,
      payment_id TEXT UNIQUE,
      user_id TEXT,
      table_name TEXT,
      product_name TEXT,
      quantity INTEGER,
      total_amount REAL,
      panel TEXT,
      status TEXT,
      keys TEXT,
      created_at TEXT,
      updated_at TEXT
    )`;
    db.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(true);
    });
  });

const normalizePaymentId = (paymentId) => String(paymentId).replace(/\.0$/, '');

const insertPixOrder = async (order) => {
  await ensurePixOrdersTable();
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    const sql = `INSERT INTO ${PIX_ORDERS_TABLE} (id, payment_id, user_id, table_name, product_name, quantity, total_amount, panel, status, keys, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      order.id || randomUUID(),
      normalizePaymentId(order.paymentId),
      order.userId,
      order.tableName,
      order.productName,
      order.quantity,
      order.totalAmount,
      order.panel,
      order.status || 'pending',
      JSON.stringify(order.keys || []),
      now,
      now
    ];
    db.run(sql, values, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(true);
    });
  });
};

const updatePixOrderStatus = async (paymentId, status, extra = {}) => {
  await ensurePixOrdersTable();
  return new Promise((resolve, reject) => {
    const updates = ['status = ?', 'updated_at = ?'];
    const values = [status, new Date().toISOString()];
    if (extra.keys) {
      updates.push('keys = ?');
      values.push(JSON.stringify(extra.keys));
    }
    const sql = `UPDATE ${PIX_ORDERS_TABLE} SET ${updates.join(', ')} WHERE payment_id = ?`;
    values.push(normalizePaymentId(paymentId));
    db.run(sql, values, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.changes);
    });
  });
};

const listPendingPixOrders = async () => {
  await ensurePixOrdersTable();
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM ${PIX_ORDERS_TABLE} WHERE status != 'approved'`;
    db.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
};

const getPixOrderByPaymentId = async (paymentId) => {
  await ensurePixOrdersTable();
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM ${PIX_ORDERS_TABLE} WHERE payment_id = ? LIMIT 1`;
    db.get(sql, [normalizePaymentId(paymentId)], (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
};

const reserveProductKeys = (tableName, quantity, usePanel2 = false) =>
  new Promise((resolve, reject) => {
    const database = usePanel2 ? panel2Db : db;
    const sanitized = sanitizeTableName(tableName);
    const sql = `SELECT id, nome FROM ${sanitized} WHERE estoque > 0 AND nome NOT LIKE ? ORDER BY id ASC LIMIT ?`;
    database.all(sql, [`${META_PREFIX}%`, quantity], (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      if (!rows.length || rows.length < quantity) {
        reject(new Error('Não há chaves suficientes em estoque.'));
        return;
      }
      const stmt = database.prepare(`DELETE FROM ${sanitized} WHERE id = ?`);
      for (const row of rows) {
        stmt.run(row.id);
      }
      stmt.finalize((stmtError) => {
        if (stmtError) {
          reject(stmtError);
          return;
        }
        resolve(rows.map((row) => row.nome));
      });
    });
  });
const addProductKeysForDb = (database, name, keys, price = 0) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const normalizedPrice = Number.isNaN(Number(price)) ? 0 : Number(price);
    const sanitizedKeys = (keys || []).map((key) => (typeof key === 'string' ? key.trim() : '')).filter((key) => key.length);
    if (!sanitizedKeys.length) {
      resolve(0);
      return;
    }
    const sql = `INSERT INTO ${tableName} (nome, preco, estoque) VALUES (?, ?, 1)`;
    const stmt = database.prepare(sql);
    try {
      for (const key of sanitizedKeys) {
        stmt.run(key, normalizedPrice);
      }
      stmt.finalize((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(sanitizedKeys.length);
      });
    } catch (error) {
      reject(error);
    }
  });

const addProductKeys = (name, keys, price = 0) => addProductKeysForDb(db, name, keys, price);
const addProductKeysPanel2 = (name, keys, price = 0) => addProductKeysForDb(panel2Db, name, keys, price);

const getProductListFromDb = async (database, tableLister) =>
  new Promise(async (resolve, reject) => {
    try {
      const tables = await tableLister();
      const products = [];
      for (const tableName of tables) {
        const info = await getProductMetadataFromDb(database, tableName).catch(() => null);
        if (!info?.row) continue;
        products.push({
          table: tableName,
          name: stripMetaName(info.row.nome) || `Produto (${tableName})`,
          price: info.row.preco,
          stock: info.stock ?? 0,
          id: info.row.id
        });
      }
      resolve(products);
    } catch (error) {
      reject(error);
    }
  });

const getProductList = () => getProductListFromDb(db, listUserTables);
const getPanel2ProductList = () => getProductListFromDb(panel2Db, listPanel2Tables);

const getProductByIdFromDb = (database, name, id) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `SELECT id, nome, preco, estoque FROM ${tableName} WHERE id = ? LIMIT 1`;
    database.get(sql, [id], (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });

const getProductById = (name, id) => getProductByIdFromDb(db, name, id);
const getPanel2ProductById = (name, id) => getProductByIdFromDb(panel2Db, name, id);

const COUPON_TABLE = 'cupom';

const ensureCouponTable = () =>
  new Promise((resolve, reject) => {
    const sql = `CREATE TABLE IF NOT EXISTS ${COUPON_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE, desconto REAL, criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`;
    db.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(true);
    });
  });

const addCoupon = async (codigo, desconto) => {
  await ensureCouponTable();
  return new Promise((resolve, reject) => {
    const sql = `INSERT OR REPLACE INTO ${COUPON_TABLE} (codigo, desconto) VALUES (?, ?)`;
    db.run(sql, [codigo, desconto], function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.lastID);
    });
  });
};

const listCoupons = async () => {
  await ensureCouponTable();
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, codigo, desconto, criado_em FROM ${COUPON_TABLE} ORDER BY criado_em DESC`;
    db.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
};

const deleteCoupon = async (codigo) => {
  await ensureCouponTable();
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM ${COUPON_TABLE} WHERE codigo = ?`;
    db.run(sql, [codigo], function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.changes);
    });
  });
};

const getCouponByCode = async (codigo) => {
  await ensureCouponTable();
  const normalized = (codigo && typeof codigo === 'string' ? codigo.trim().toUpperCase() : '');
  if (!normalized.length) {
    return null;
  }
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, codigo, desconto FROM ${COUPON_TABLE} WHERE codigo = ? LIMIT 1`;
    db.get(sql, [normalized], (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
};

module.exports = {
  ensureTable,
  ensurePanel2Table,
  insertProduct,
  listUserTables,
  listPanel2Tables,
  ensureMetaRow,
  ensurePanel2MetaRow,
  countStockRows,
  countPanel2StockRows,
  addProductKeys,
  addProductKeysPanel2,
  getProductList,
  getPanel2ProductList,
  getMetaRow,
  getProductById,
  getPanel2ProductById,
  updateProduct,
  updateProductPanel2,
  getProductMetadata,
  getPanel2ProductMetadata,
  insertPixOrder,
  updatePixOrderStatus,
  listPendingPixOrders,
  getPixOrderByPaymentId,
  reserveProductKeys,
  ensureCouponTable,
  addCoupon,
  listCoupons,
  deleteCoupon,
  getCouponByCode
};
