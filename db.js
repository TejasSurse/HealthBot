// db.js
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: "<>",
  port: 4000,
  user: "<>",
  password: "<>",
  database: "healthbotsys",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
    ssl: {
        rejectUnauthorized: false,
    },
});

console.log("✅ MySQL Connected!");

export default pool;
