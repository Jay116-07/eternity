const backend = process.cwd();
const run_config = (backend.toLowerCase().startsWith("/mnt/c/") ? "dev" : "prod");

const secrets = (run_config == "dev" ? (await import(`${backend}/.secrets.mjs`)).dev : (await import(`${backend}/.secrets.mjs`)).prod);

import node_pg from "pg";
import axios from "axios";

const pool = new node_pg.Pool({ // https://node-postgres.com/api/pool
	connectionString: secrets.sql_connection,
	max: (run_config == "dev" ? 1 : 5),
	idleTimeoutMillis: 0
});

async function init_db() {
	const client = await pool.connect();

	if (run_config == "dev") {
		const result = await client.query(`
			select table_name 
			from information_schema.tables 
			where table_schema = 'public' 
				and table_type = 'BASE TABLE';
		`);
		const all_tables = result.rows;
		await Promise.all(all_tables.map((table) => {
			client.query(`
				drop table ${table.table_name} cascade;
			`);
		}));
		console.log("dropped all tables");
	} else if (run_config == "prod") {
		console.log("kept all tables");
	}

	await client.query(`
		create table if not exists user_ (
			username text primary key, 
			reddit_api_refresh_token_encrypted text, -- decrypt ➔ string
			category_sync_info json, 
			last_updated_epoch bigint, 
			last_active_epoch bigint, 
			email_encrypted text, -- decrypt ➔ string
			email_notif json, 
			firebase_service_acc_key_encrypted text, -- decrypt ➔ json string
			firebase_web_app_config_encrypted text -- decrypt ➔ json string
		);
	`);
	console.log("created table (user_) if not exist");

	client.release();
}

async function backup_db() {
	await axios.post("https://api.elephantsql.com/api/backup", {}, {
		auth: {
			username: "",
			password: secrets.sql_api_key
		}
	});
	console.log("backed up db");
}
function cycle_backup_db() {
	backup_db().catch((err) => console.error(err));

	setInterval(() => {
		backup_db().catch((err) => console.error(err));
	}, 86400000); // 24h
}

async function query(query) {
	const client = await pool.connect();
	let result = null;
	try {
		result = await client.query(query);
	} catch (err) {
		console.error(err);
	} finally {
		client.release();
	}
	const rows = (result ? result.rows : null);
	return rows;
}

export {
	init_db,
	cycle_backup_db,
	query
};
