// db.js
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: "gateway01.ap-northeast-1.prod.aws.tidbcloud.com",
  port: 4000,
  user: "4EYmJTz3qoD4Nv2.root",
  password: "jpduR0LNzgU1aM3I",
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
