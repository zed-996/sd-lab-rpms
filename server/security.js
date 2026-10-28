'use strict';
const crypto=require('node:crypto');

const JWT_SECRET=process.env.RPMS_JWT_SECRET||crypto.randomBytes(48).toString('hex');
const SESSION_TTL_SECONDS=30*60;
const b64url=value=>Buffer.from(value).toString('base64url');
const signature=input=>crypto.createHmac('sha256',JWT_SECRET).update(input).digest('base64url');

function createToken(userId,sessionId,now=Math.floor(Date.now()/1000)){
  const head=b64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const body=b64url(JSON.stringify({sub:userId,sid:sessionId,iat:now,exp:now+SESSION_TTL_SECONDS}));
  const input=`${head}.${body}`;
  return `${input}.${signature(input)}`;
}
function verifyToken(token,now=Math.floor(Date.now()/1000)){
  try{
    const [head,body,sig]=String(token||'').split('.');
    if(!head||!body||!sig)return null;
    const input=`${head}.${body}`;
    const got=Buffer.from(sig),expected=Buffer.from(signature(input));
    if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return null;
    const claims=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(claims.exp<=now||!claims.sub||!claims.sid)return null;
    return claims;
  }catch{return null;}
}
function bearer(req){
  const value=String(req.headers.authorization||'');
  return value.startsWith('Bearer ')?value.slice(7):'';
}
function sessionExpiry(now=new Date()){
  return new Date(now.getTime()+SESSION_TTL_SECONDS*1000).toISOString().slice(0,19).replace('T',' ');
}

module.exports={createToken,verifyToken,bearer,sessionExpiry,SESSION_TTL_SECONDS};
