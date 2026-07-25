import pg from 'pg';
import assert from 'assert';

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:51214/template1?sslmode=disable";
const pool = new pg.Pool({ connectionString });

async function verify() {
  const client = await pool.connect();
  try {
    // Check users table
    const usersRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    assert(usersRes.rows.length > 0, "Table 'users' does not exist");
    console.log("Verified 'users' table exists.");

    // Check chats table
    const chatsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'chats'
    `);
    assert(chatsRes.rows.length > 0, "Table 'chats' does not exist");
    console.log("Verified 'chats' table exists.");

    // Check messages table
    const messagesRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'messages'
    `);
    assert(messagesRes.rows.length > 0, "Table 'messages' does not exist");
    console.log("Verified 'messages' table exists.");

    console.log("All tables verified successfully!");
  } catch (err) {
    console.error("Verification failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

verify();
