'use strict';

const mysql=require('mysql2/promise');

async function createPool(){
  const database=process.env.RPMS_DB_NAME||'rpms';
  if(!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('RPMS_DB_NAME may contain only letters, numbers and underscores.');
  const user=process.env.RPMS_DB_USER||(process.env.NODE_ENV==='production'?'':'root');
  const password=process.env.RPMS_DB_PASSWORD||'';
  if(process.env.NODE_ENV==='production'&&(!user||user==='root'||!password))throw new Error('Production requires a dedicated RPMS_DB_USER and RPMS_DB_PASSWORD.');
  const base={host:process.env.RPMS_DB_HOST||'127.0.0.1',port:Number(process.env.RPMS_DB_PORT||3306),user,password,timezone:'Z',decimalNumbers:true,...(process.env.RPMS_DB_SSL==='1'?{ssl:{rejectUnauthorized:true}}:{})};
  const bootstrap=await mysql.createConnection(base);
  try{await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);}finally{await bootstrap.end();}
  return mysql.createPool({...base,database,waitForConnections:true,connectionLimit:Number(process.env.RPMS_DB_POOL_SIZE||10),queueLimit:0,charset:'utf8mb4',enableKeepAlive:true,keepAliveInitialDelay:0});
}
module.exports={createPool};
