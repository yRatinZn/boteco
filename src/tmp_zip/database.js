const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'Produtos1.db');
const db = new sqlite3.Database(dbPath, (error) => {
  if (error) {
    console.error('Não foi possível abrir a base de dados Produtos1:', error);
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

const ensureTable = (name) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, preco REAL, estoque INTEGER)`;
    db.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(tableName);
    });
  });

const insertProduct = (name, produto) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `INSERT INTO ${tableName} (nome, preco, estoque) VALUES (?, ?, ?)`;
    db.run(sql, [produto.nome, produto.preco, produto.estoque], function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.lastID);
    });
  });

const updateProduct = (name, data) =>
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
    db.run(sql, values, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this.changes);
    });
  });

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

const getMetaRow = (name, metaName) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const comparator = metaName ? 'nome = ?' : 'nome LIKE ?';
    const param = metaName ? metaName : `${META_PREFIX}%`;
    const sql = `SELECT id, nome, preco, estoque FROM ${tableName} WHERE ${comparator} LIMIT 1`;
    db.get(sql, [param], (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });

const ensureMetaRow = async (name, productName, price) => {
  const tableName = sanitizeTableName(name);
  const metaName = metaNameFor(productName);
  let meta = await getMetaRow(tableName, metaName).catch(() => null);
  if (!meta) {
    meta = await getMetaRow(tableName).catch(() => null);
  }
  if (meta) {
    await updateProduct(tableName, { id: meta.id, nome: metaName, preco: price, estoque: META_STOCK });
    return { ...meta, nome: metaName, preco: price, estoque: META_STOCK };
  }
  const id = await insertProduct(tableName, { nome: metaName, preco: price, estoque: META_STOCK });
  return { id, nome: metaName, preco: price, estoque: META_STOCK };
};

const countStockRows = (name) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `SELECT COUNT(1) AS total FROM ${tableName} WHERE estoque > 0`;
    db.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row?.total ?? 0);
    });
  });

const getRepresentativeRow = (name) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `SELECT id, nome, preco, estoque FROM ${tableName} WHERE estoque >= 0 ORDER BY estoque DESC LIMIT 1`;
    db.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });

const getProductMetadata = async (name) => {
  const tableName = sanitizeTableName(name);
  const meta = await getMetaRow(tableName).catch(() => null);
  if (meta) {
    const stock = await countStockRows(tableName).catch(() => 0);
    return { row: meta, isMeta: true, stock };
  }
  const representative = await getRepresentativeRow(tableName).catch(() => null);
  if (representative) {
    const stock = await countStockRows(tableName).catch(() => 0);
    return { row: representative, isMeta: false, stock };
  }
  return null;
};

const addProductKeys = (name, keys, price = 0) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const normalizedPrice = Number.isNaN(Number(price)) ? 0 : Number(price);
    const sanitizedKeys = (keys || []).map((key) => (typeof key === 'string' ? key.trim() : '')).filter((key) => key.length);
    if (!sanitizedKeys.length) {
      resolve(0);
      return;
    }
    const sql = `INSERT INTO ${tableName} (nome, preco, estoque) VALUES (?, ?, 1)`;
    const stmt = db.prepare(sql);
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

const getProductList = () =>
  new Promise(async (resolve, reject) => {
    try {
      const tables = await listUserTables();
      const products = [];
      for (const tableName of tables) {
        const info = await getProductMetadata(tableName).catch(() => null);
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

const getProductById = (name, id) =>
  new Promise((resolve, reject) => {
    const tableName = sanitizeTableName(name);
    const sql = `SELECT id, nome, preco, estoque FROM ${tableName} WHERE id = ? LIMIT 1`;
    db.get(sql, [id], (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });

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
  insertProduct,
  listUserTables,
  ensureMetaRow,
  countStockRows,
  addProductKeys,
  getProductList,
  getMetaRow,
  updateProduct,
  getProductById,
  getProductMetadata,
  ensureCouponTable,
  addCoupon,
  listCoupons,
  deleteCoupon,
  getCouponByCode
};
