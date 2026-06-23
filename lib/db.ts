import { Pool, type ClientBase, type QueryResultRow } from "pg"
import { DsqlSigner } from "@aws-sdk/dsql-signer"
import { awsCredentialsProvider } from "@vercel/functions/oidc"
import { attachDatabasePool } from "@vercel/functions"

const region = process.env.AWS_REGION as string
const hostname = process.env.PGHOST as string

const signer = new DsqlSigner({
  credentials: awsCredentialsProvider({
    roleArn: process.env.AWS_ROLE_ARN as string,
    clientConfig: { region },
  }),
  region,
  hostname,
  expiresIn: 900,
})

const globalForPool = globalThis as unknown as { _polisPool?: Pool }

const pool =
  globalForPool._polisPool ??
  new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER || "admin",
    database: process.env.PGDATABASE || "postgres",
    password: () => signer.getDbConnectAdminAuthToken(),
    port: 5432,
    ssl: true,
    max: 20,
  })

if (!globalForPool._polisPool) {
  attachDatabasePool(pool)
  globalForPool._polisPool = pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params)
}

export async function withConnection<T>(fn: (client: ClientBase) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
