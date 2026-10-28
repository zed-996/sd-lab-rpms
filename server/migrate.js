'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createPool}=require('./database');
const repository=require('./repository');

function statements(source){
  let delimiter=';',buffer='',out=[];
  for(const line of source.split(/\r?\n/)){
    const trimmed=line.trim();
    if(trimmed.toUpperCase().startsWith('DELIMITER ')){delimiter=trimmed.slice(9).trim();continue;}
    buffer+=line+'\n';
    if(trimmed.endsWith(delimiter)){
      const statement=buffer.trim().slice(0,-delimiter.length).trim();
      if(statement)out.push(statement);
      buffer='';
    }
  }
  if(buffer.trim())out.push(buffer.trim());
  return out;
}
async function migrate(pool,projectRoot=path.resolve(__dirname,'..')){
  const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  const conn=await pool.getConnection();
  try{
    for(const statement of statements(sql)){
      const trigger=statement.match(/^CREATE\s+TRIGGER\s+`?([A-Za-z0-9_]+)`?/i);
      if(trigger){
        const [existing]=await conn.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?',[trigger[1]]);
        if(existing.length)continue;
      }
      await conn.query(statement);
    }
    await repository.initialize(conn,projectRoot);
  }finally{conn.release();}
}
if(require.main===module){
  createPool().then(async pool=>{try{await migrate(pool);process.stdout.write('RPMS MySQL schema is ready.\n');}finally{await pool.end();}}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={migrate,statements};
