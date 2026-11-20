const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return json({ok:true,effiConfigured:!!env.EFFI_API_KEY});
 if(url.pathname!=="/api/articulo")return env.ASSETS.fetch(request);
 if(request.method!=="GET")return json({ok:false,error:"Método no permitido"},405);
 const ref=(url.searchParams.get("referencia")||"").trim();
 if(!ref||ref.length>80||!/^[\p{L}\p{N}._\-/ ]+$/u.test(ref))return json({ok:false,error:"Referencia inválida"},400);
 if(!env.EFFI_API_KEY)return json({ok:false,error:"Falta configurar EFFI_API_KEY en Cloudflare"},503);
 try{
  const target=new URL("https://effi.com.co/api/articulo");target.searchParams.set("referencia",ref);target.searchParams.set("pagina","1");target.searchParams.set("por_pagina","20");
  const res=await fetch(target,{headers:{Authorization:"Bearer "+env.EFFI_API_KEY,Accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(!res.ok)return json({ok:false,error:"Effi no respondió correctamente",status:res.status},502);
  const body=await res.json();if(body.ok===false)return json({ok:false,error:"Effi rechazó la consulta"},502);
  const items=Array.isArray(body.data)?body.data: [];
  const exact=items.filter(x=>String(x.referencia||"").trim().toUpperCase()===ref.toUpperCase()&&String(x.vigente??"1")!=="0");
  return json({ok:true,data:exact.map(x=>({id:x.id,referencia:x.referencia,descripcion:x.descripcion,nombre_categoria:x.nombre_categoria,precios_venta:x.precios_venta,url_foto:x.url_foto,stock_empresa:x.stock_empresa}))});
 }catch(e){return json({ok:false,error:"No se pudo completar la consulta a Effi"},502);}
}};