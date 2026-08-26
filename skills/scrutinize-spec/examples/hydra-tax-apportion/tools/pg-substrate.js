/**
 * Execution substrate — DISPOSABLE Postgres (ephemeral docker container) + TypeORM.
 *
 * For decimal-DEPENDENT billing slices. Unlike the in-memory SQLite substrate,
 * real Postgres returns `decimal`/`numeric` columns as EXACT strings (preserving
 * scale), so behaviour that reads/compares/returns tax_rate can be validated
 * honestly here. See tools/pg-decimal-probe.js for the confirmation that the
 * SQLite lie (decimal -> lossy number) does NOT occur on Postgres.
 *
 * The container is fully ephemeral: `docker run --rm` on a throwaway port bound to
 * 127.0.0.1, torn down in `stop()`. It points at NOTHING real — it never touches
 * port 3309 or any production billing database. Requires a usable docker daemon.
 */

require("reflect-metadata");
const net = require("net");
const { execFileSync, spawnSync } = require("child_process");
const { DataSource, EntitySchema } = require("typeorm");

const IMAGE = "postgres:16-alpine";
const PGUSER = "sdd";
const PGPASSWORD = "sdd";
const PGDB = "sdd";

const commonColumns = {
  id: { type: Number, primary: true, generated: true },
  provinceId: { name: "province_id", type: "int" },
  taxName: { name: "tax_name", type: "varchar" },
  taxRate: { name: "tax_rate", type: "decimal" }, // EXACT string on Postgres
  hydraState: { name: "hydra_state", type: "enum", enum: ["active", "deleted"] }, // real Postgres enum (SQLite could not)
  effectiveFrom: { name: "effective_from", type: "date" },
  effectiveUntil: { name: "effective_until", type: "date", nullable: true },
};

const TaxByProvince = new EntitySchema({
  name: "TaxByProvince",
  tableName: "taxes_by_province",
  columns: { ...commonColumns },
});

function docker(args, opts = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...opts });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** Start an ephemeral Postgres; returns { containerName, port, stop }. */
async function startPostgres({ timeoutMs = 60000 } = {}) {
  const usable = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (usable.status !== 0) {
    throw new Error("docker is not usable in this environment (daemon down or not installed) — cannot start the Postgres substrate");
  }
  const port = await freePort();
  const containerName = `sdd-pg-${process.pid}-${port}`;
  // Clean any stale container of the same name (defensive; --rm should prevent this).
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });

  docker([
    "run", "--rm", "-d",
    "--name", containerName,
    "-e", `POSTGRES_USER=${PGUSER}`,
    "-e", `POSTGRES_PASSWORD=${PGPASSWORD}`,
    "-e", `POSTGRES_DB=${PGDB}`,
    "-p", `127.0.0.1:${port}:5432`,
    IMAGE,
  ]);

  const stop = () => spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });

  // Wait for readiness via pg_isready inside the container.
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < timeoutMs) {
    const r = spawnSync("docker", ["exec", containerName, "pg_isready", "-U", PGUSER, "-d", PGDB], { stdio: "ignore" });
    if (r.status === 0) { ready = true; break; }
    // busy-wait ~300ms without a timer dependency
    const until = Date.now() + 300;
    while (Date.now() < until) { /* spin */ }
  }
  if (!ready) {
    stop();
    throw new Error(`Postgres container did not become ready within ${timeoutMs}ms`);
  }
  return { containerName, port, stop };
}

async function createDataSource(port, entities = [TaxByProvince]) {
  const ds = new DataSource({
    type: "postgres",
    host: "127.0.0.1",
    port,
    username: PGUSER,
    password: PGPASSWORD,
    database: PGDB,
    synchronize: true,
    entities,
  });
  // TypeORM may briefly race the container's auth bootstrap; retry connect.
  let lastErr;
  for (let i = 0; i < 40; i++) {
    try {
      await ds.initialize();
      return ds;
    } catch (e) {
      lastErr = e;
      const until = Date.now() + 300;
      while (Date.now() < until) { /* spin */ }
    }
  }
  throw lastErr;
}

async function reset(ds) {
  await ds.getRepository("TaxByProvince").query('TRUNCATE TABLE "taxes_by_province" RESTART IDENTITY CASCADE');
}

async function seed(ds, data) {
  const rows = (data.base || []).map((r) => ({ taxRate: "1.00", ...r }));
  if (rows.length) await ds.getRepository("TaxByProvince").save(rows);
}

module.exports = { startPostgres, createDataSource, reset, seed, TaxByProvince };
