const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const enc=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
async function sign(value,secret){
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,enc.encode(value)));
}
async function authorized(request,secret){
 if(!secret)return false;
 const match=(request.headers.get('cookie')||'').match(/(?:^|;\\s*)tg_session=([^;]+)/);
 if(!match)return false;
 const parts=match[1].split('.');if(parts.length!==2)return false;
 const expiry=Number(parts[0]);if(!Number.isSafeInteger(expiry)||expiry<Date.now()||expiry>Date.now()+86400000)return false;
 const expected=await sign(parts[0],secret);
 return parts[1]===expected;
}
const sessionCookie=(value,maxAge)=>'tg_session='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
export default {async fetch(request,env){
 const url=new URL(request.url);
 const secret=env.clave_portal_escanner;
 if(url.pathname==="/api/auth/status")return json({authenticated:await authorized(request,secret),configured:!!secret});
 if(url.pathname==="/api/auth/login"){
  if(request.method!=="POST")return json({ok:false,error:"Método no permitido"},405);
  if(!secret)return json({ok:false,error:"Falta configurar clave_portal_escanner como Secret"},503);
  let body;try{if(Number(request.headers.get('content-length')||0)>1024)return json({ok:false,error:"Solicitud demasiado grande"},413);body=await request.json();}catch{return json({ok:false,error:"Solicitud inválida"},400);}
  const provided=typeof body?.password==='string'?body.password:'';
  const a=await sign(provided,'tg-login-compare'),b=await sign(secret,'tg-login-compare');
  if(a!==b)return json({ok:false,error:"Contraseña incorrecta"},401);
  const expiry=String(Date.now()+8*60*60*1000),signature=await sign(expiry,secret);
  const response=json({ok:true});response.headers.set('Set-Cookie',sessionCookie(expiry+'.'+signature,8*60*60));return response;
 }
 if(url.pathname==="/api/auth/logout"){
  if(request.method!=="POST")return json({ok:false,error:"Método no permitido"},405);
  const response=json({ok:true});response.headers.set('Set-Cookie',sessionCookie('',0));return response;
 }
 if(url.pathname==="/api/health")return json({ok:true,effiConfigured:!!env.appi_effi,portalConfigured:!!secret});
 if(url.pathname!=="/api/articulo")return env.ASSETS.fetch(request);
 if(!await authorized(request,secret))return json({ok:false,error:"Sesión no autorizada",code:"UNAUTHORIZED"},401);
 if(request.method!=="GET")return json({ok:false,error:"Método no permitido"},405);
 const ref=(url.searchParams.get("referencia")||"").trim();
 if(!ref||ref.length>80||!/^[\p{L}\p{N}._\-/ ]+$/u.test(ref))return json({ok:false,error:"Referencia inválida"},400);
 if(!env.appi_effi)return json({ok:false,error:"Falta configurar appi_effi en Cloudflare"},503);
 try{
  const target=new URL("https://effi.com.co/api/articulo");target.searchParams.set("referencia",ref);target.searchParams.set("pagina","1");target.searchParams.set("por_pagina","20");
  const res=await fetch(target,{headers:{Authorization:"Bearer "+env.appi_effi,Accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(!res.ok)return json({ok:false,error:"Effi no respondió correctamente",status:res.status},502);
  const body=await res.json();if(body.ok===false)return json({ok:false,error:"Effi rechazó la consulta"},502);
  const items=Array.isArray(body.data)?body.data: [];
  const exact=items.filter(x=>String(x.referencia||"").trim().toUpperCase()===ref.toUpperCase()&&String(x.vigente??"1")!=="0");
  return json({ok:true,data:exact.map(x=>({id:x.id,referencia:x.referencia,descripcion:x.descripcion,nombre_categoria:x.nombre_categoria,precios_venta:x.precios_venta,url_foto:x.url_foto,stock_empresa:x.stock_empresa}))});
 }catch(e){return json({ok:false,error:"No se pudo completar la consulta a Effi"},502);}
}};