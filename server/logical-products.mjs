import { randomBytes } from "node:crypto";

export function initializeLogicalProductSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS logical_products (
      logical_product_id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      category TEXT NOT NULL,
      universe TEXT NOT NULL,
      image_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logical_product_members (
      product_key TEXT PRIMARY KEY,
      logical_product_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      FOREIGN KEY(product_key) REFERENCES products_current(product_key) ON DELETE CASCADE,
      FOREIGN KEY(logical_product_id) REFERENCES logical_products(logical_product_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS logical_product_aliases (
      alias_id TEXT PRIMARY KEY,
      logical_product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(logical_product_id) REFERENCES logical_products(logical_product_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS logical_product_members_id_idx
      ON logical_product_members(logical_product_id);
  `);
}

export function createLogicalProductId(random = randomBytes) {
  return random(8).toString("hex");
}

function memberKeys(group) {
  return [...new Set([group?.productKey, ...(group?.comparisons || []).map((offer) => offer?.productKey)].filter(Boolean))];
}

export function assignLogicalProductIds(database, groups, { now = new Date(), createId = createLogicalProductId } = {}) {
  const timestamp = new Date(now).toISOString();
  const memberFrequency = new Map();
  for (const group of groups || []) {
    for (const key of memberKeys(group)) memberFrequency.set(key, (memberFrequency.get(key) || 0) + 1);
  }
  const existingMembers = new Map(database.prepare(`
    SELECT product_key AS productKey, logical_product_id AS logicalProductId
    FROM logical_product_members
  `).all().map((row) => [row.productKey, row.logicalProductId]));
  const insertProduct = database.prepare(`
    INSERT OR IGNORE INTO logical_products (
      logical_product_id, canonical_name, category, universe, image_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateProduct = database.prepare(`
    UPDATE logical_products
    SET canonical_name = ?, category = ?, universe = ?, image_url = ?, updated_at = ?
    WHERE logical_product_id = ?
      AND (canonical_name <> ? OR category <> ? OR universe <> ? OR COALESCE(image_url, '') <> COALESCE(?, ''))
  `);
  const upsertMember = database.prepare(`
    INSERT INTO logical_product_members(product_key, logical_product_id, assigned_at)
    VALUES (?, ?, ?)
    ON CONFLICT(product_key) DO UPDATE SET
      logical_product_id = excluded.logical_product_id,
      assigned_at = excluded.assigned_at
    WHERE logical_product_members.logical_product_id <> excluded.logical_product_id
  `);
  const reassignMembers = database.prepare(`
    UPDATE logical_product_members SET logical_product_id = ?, assigned_at = ? WHERE logical_product_id = ?
  `);
  const insertAlias = database.prepare(`
    INSERT INTO logical_product_aliases(alias_id, logical_product_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(alias_id) DO UPDATE SET logical_product_id = excluded.logical_product_id
  `);
  const deleteProduct = database.prepare(`
    DELETE FROM logical_products WHERE logical_product_id = ?
  `);
  const reassignAliases = database.prepare(`
    UPDATE logical_product_aliases SET logical_product_id = ? WHERE logical_product_id = ?
  `);
  const deleteMember = database.prepare(`
    DELETE FROM logical_product_members WHERE product_key = ?
  `);

  const identified = [];
  const usedIds = new Set();
  const claimedMemberKeys = new Set();
  database.exec("BEGIN IMMEDIATE");
  try {
    const primaryKeys = new Set((groups || []).map((group) => group?.productKey).filter(Boolean));
    for (const [key, frequency] of memberFrequency) {
      if (frequency > 1 && !primaryKeys.has(key)) {
        deleteMember.run(key);
        existingMembers.delete(key);
      }
    }
    for (const group of groups || []) {
      // Fuzzy comparison candidates can overlap. Ambiguous comparison members
      // must not influence persistent identity; only the group's primary member
      // and comparisons unique to this refresh are durable evidence.
      const keys = memberKeys(group).filter((key) => (
        key === group.productKey || memberFrequency.get(key) === 1
      ) && !claimedMemberKeys.has(key));
      if (keys.length === 0) continue;
      for (const key of keys) claimedMemberKeys.add(key);
      const assignedIds = [...new Set(keys.map((key) => existingMembers.get(key)).filter(Boolean))];
      const primaryAssigned = group.productKey ? existingMembers.get(group.productKey) : null;
      const preferredId = primaryAssigned || assignedIds[0] || null;
      const logicalProductId = preferredId && !usedIds.has(preferredId) ? preferredId : createId();
      insertProduct.run(
        logicalProductId,
        group.name,
        group.category || "Autres",
        group.universe || "home",
        group.imageUrl || null,
        timestamp,
        timestamp,
      );
      for (const obsoleteId of assignedIds.filter((id) => id !== logicalProductId && !usedIds.has(id))) {
        reassignMembers.run(logicalProductId, timestamp, obsoleteId);
        reassignAliases.run(logicalProductId, obsoleteId);
        insertAlias.run(obsoleteId, logicalProductId, timestamp);
        deleteProduct.run(obsoleteId);
        for (const [key, value] of existingMembers) if (value === obsoleteId) existingMembers.set(key, logicalProductId);
      }
      usedIds.add(logicalProductId);
      for (const key of keys) {
        upsertMember.run(key, logicalProductId, timestamp);
        existingMembers.set(key, logicalProductId);
      }
      updateProduct.run(
        group.name,
        group.category || "Autres",
        group.universe || "home",
        group.imageUrl || null,
        timestamp,
        logicalProductId,
        group.name,
        group.category || "Autres",
        group.universe || "home",
        group.imageUrl || null,
      );
      identified.push({ ...group, logicalProductId });
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return identified;
}

export function resolveLogicalProductId(database, value) {
  const id = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const direct = database.prepare(`
    SELECT logical_product_id AS logicalProductId FROM logical_products WHERE logical_product_id = ?
  `).get(id)?.logicalProductId;
  if (direct) return direct;
  return database.prepare(`
    SELECT logical_product_id AS logicalProductId FROM logical_product_aliases WHERE alias_id = ?
  `).get(id)?.logicalProductId || null;
}
