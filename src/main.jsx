import React,{useEffect,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
import{createWorker,PSM}from'tesseract.js';
import './style.css';
function parseTarifas(raw){
 const result={detal:null,mayor:null};
 for(const entry of String(raw||'').split(';')){
  const separator=entry.indexOf(':');
  if(separator<0)continue;
  const name=entry.slice(0,separator).trim().toLocaleLowerCase('es');
  const value=entry.slice(separator+1).trim();
  if(!value)continue;
  if(name.includes('emprendedor'))continue;
  if(name.includes('mayorista')||name.includes('mayor'))result.mayor=value;
  else if(name.includes('normal'))result.detal=value;
 }
 return result;
}
function formatPrecio(value){
 if(!value)return 'No disponible';
 const cleaned=String(value).replace(/[^\d.,-]/g,'');
 if(!cleaned)return String(value);
 let normalized=cleaned;
 if(/^\d{1,3}(?:[.,]\d{3})+$/.test(cleaned))normalized=cleaned.replace(/[.,]/g,'');
 else if(cleaned.includes(',')&&cleaned.includes('.'))normalized=cleaned.lastIndexOf(',')>cleaned.lastIndexOf('.')?cleaned.replace(/\./g,'').replace(',','.'):cleaned.replace(/,/g,'');
 else if(cleaned.includes(','))normalized=cleaned.replace(',','.');
 const n=Number(normalized);
 return Number.isFinite(n)?new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n):String(value);
}
function App(){
 const [authenticated,setAuthenticated]=useState(null),[password,setPassword]=useState(''),[authError,setAuthError]=useState(''),[authBusy,setAuthBusy]=useState(false);
 useEffect(()=>{fetch('/api/auth/status',{credentials:'same-origin'}).then(r=>r.json()).then(x=>{setAuthenticated(!!x.authenticated);if(!x.configured)setAuthError('Configura clave_portal_escanner como Secret en Cloudflare.');}).catch(()=>{setAuthenticated(false);setAuthError('No fue posible verificar la sesión.');});},[]);
 async function login(e){e.preventDefault();setAuthBusy(true);setAuthError('');try{const r=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({password})});const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo iniciar sesión');setAuthenticated(true);setPassword('');}catch(e){setAuthError(e.message);}finally{setAuthBusy(false);}}
 async function logout(){stop();await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});setAuthenticated(false);setPassword('');setItem(null);}

 const video=useRef(null),stream=useRef(null),ocr=useRef(null),running=useRef(false),busy=useRef(false),locked=useRef(false),votes=useRef({ref:'',n:0}),generation=useRef(0),rejected=useRef(new Map()),audioContext=useRef(null);
 const [soundEnabled,setSoundEnabled]=useState(true);
 const [status,setStatus]=useState('Inicia la cámara para escanear'),[recognized,setRecognized]=useState('—'),[manual,setManual]=useState(''),[item,setItem]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[active,setActive]=useState(false),[paused,setPaused]=useState(false);
 const normalize=s=>String(s||'').toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9._\-/]/g,'');
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function unlockAudio(){
  try{const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return;
   if(!audioContext.current)audioContext.current=new AudioContextClass();
   if(audioContext.current.state==='suspended')audioContext.current.resume().catch(()=>{});
  }catch{}
 }
 function playScanSound(){
  if(!soundEnabled)return;
  try{const ctx=audioContext.current;if(!ctx||ctx.state!=='running')return;
   const start=ctx.currentTime+.01;
   [[1050,0,.075],[1450,.095,.105]].forEach(([frequency,offset,duration])=>{
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start+offset);
    gain.gain.setValueAtTime(.0001,start+offset);
    gain.gain.exponentialRampToValueAtTime(.11,start+offset+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,start+offset+duration);
    oscillator.connect(gain);gain.connect(ctx.destination);
    oscillator.start(start+offset);oscillator.stop(start+offset+duration+.01);
   });
  }catch{}
 }
 // Identify the horizontal reference immediately above a currency line.
 // A price is an anchor, never a candidate reference.
 function extractReference(data,width,height){
  const lines=(data.lines||[]).map(line=>{
   const b=line.bbox||{};return {text:String(line.text||'').trim(),x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2,left:b.x0,right:b.x1,top:b.y0,bottom:b.y1};
  }).filter(l=>Number.isFinite(l.x)&&l.text);
  const prices=lines.filter(l=>/\$\s*\d[\d.,]*/.test(l.text)||/^\s*\d{1,3}(?:[.,]\d{3})+(?:\s*\$)?\s*$/.test(l.text));
  const pairs=[];
  for(const price of prices){
   for(const line of lines){
    if(line===price||line.y>=price.y||line.bottom>price.top+12)continue;
    const ref=normalize(line.text);
    if(ref.length<3||ref.length>30||!/[A-Z]/.test(ref)||!/[0-9]/.test(ref))continue;
    if(/\$/.test(line.text)||/^(CADENAS?|ARETES?|PULSERAS?|TOROGOLD)$/.test(ref))continue;
    const dy=price.top-line.bottom,dx=Math.abs(price.x-line.x);
    if(dy>height*.22||dx>width*.24)continue;
    pairs.push({ref,score:Math.abs(line.x-width/2)/width+dy/height+dx/width});
   }
  }
  pairs.sort((a,b)=>a.score-b.score);
  return pairs[0]?.ref||null;
 }
 async function lookup(value){
  const ref=normalize(value);if(!ref||busy.current)return;
  busy.current=true;setLoading(true);setError('');setStatus('Consultando '+ref+' en Effi…');
  try{
   const response=await fetch('/api/articulo?referencia='+encodeURIComponent(ref));
   const result=await response.json();
   if(response.status===401){stop();setAuthenticated(false);throw Error('Tu sesión venció. Ingresa nuevamente.');}if(!response.ok||!result.ok)throw Error(result.error||'No fue posible consultar Effi');
   if(result.data?.length){playScanSound();setItem(result.data[0]);setRecognized(ref);locked.current=true;setPaused(true);setStatus('Producto encontrado · lectura detenida');if(navigator.vibrate)navigator.vibrate(80);}
   else{rejected.current.set(ref,Date.now()+5000);setStatus('Referencia no encontrada. Ajusta la etiqueta.');setError('Effi no encontró la referencia '+ref);votes.current={ref:'',n:0};}
  }catch(e){setError(e.message);setStatus('Error al consultar Effi');}
  finally{busy.current=false;setLoading(false);}
 }
 function next(){
  locked.current=false;votes.current={ref:'',n:0};rejected.current.clear();setPaused(false);setRecognized('—');setItem(null);setError('');setStatus(active?'Enfoca la siguiente referencia':'Inicia la cámara para escanear');
 }
 async function start(){
  unlockAudio();setError('');try{
   const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
   stream.current=s;video.current.srcObject=s;await video.current.play();setActive(true);setStatus('Cargando motor OCR…');
   const worker=await createWorker('eng',1,{logger:()=>{}});
   await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
   ocr.current=worker;running.current=true;setStatus('Enfoca una sola referencia');scan(generation.current);
  }catch(e){setError('No se pudo iniciar la cámara o el OCR. Revisa permisos, HTTPS y conexión.');stop();}
 }
 function stop(){generation.current++;running.current=false;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;const w=ocr.current;ocr.current=null;if(w)w.terminate();setActive(false);setStatus('Cámara detenida');}
 async function scan(gen){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  while(running.current&&gen===generation.current){
   if(locked.current||busy.current||!video.current?.videoWidth){await wait(130);continue;}
   try{
    const v=video.current,vw=v.videoWidth,vh=v.videoHeight;
    const rect=v.getBoundingClientRect(),ratio=Math.max(rect.width/vw,rect.height/vh);
    const visibleW=rect.width/ratio,visibleH=rect.height/ratio;
    const left=(vw-visibleW)/2,top=(vh-visibleH)/2;
    const sx=left+visibleW*.045,sy=top+visibleH*.25,sw=visibleW*.91,sh=visibleH*.50;
    canvas.width=1280;canvas.height=640;
    ctx.filter='grayscale(1) contrast(1.65)';
    ctx.drawImage(v,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    ctx.filter='none';
    const result=await ocr.current.recognize(canvas);
    if(gen!==generation.current)break;
    const candidate=extractReference(result.data,canvas.width,canvas.height);
    if(candidate){
      setRecognized(candidate);
      votes.current=candidate===votes.current.ref?{ref:candidate,n:votes.current.n+1}:{ref:candidate,n:1};
      setStatus('Referencia sobre precio: '+candidate);
      if(votes.current.n>=2&&!((rejected.current.get(candidate)||0)>Date.now())){
        votes.current={ref:'',n:0};await lookup(candidate);
      }
    }else{votes.current={ref:'',n:0};setRecognized('Buscando referencia sobre el precio…');}
   }catch(e){if(running.current)setStatus('Ajusta el enfoque o la iluminación');}
   await wait(90);
  }
 }
 useEffect(()=>()=>{generation.current++;running.current=false;stream.current?.getTracks().forEach(t=>t.stop());ocr.current?.terminate();audioContext.current?.close().catch(()=>{})},[]);
 if(authenticated===null)return <main className="login-page"><div className="login-card"><img src="/toro-gold-isotipo.svg" alt="TORO GOLD"/><h1>Verificando acceso…</h1></div></main>;
 if(!authenticated)return <main className="login-page"><section className="login-card"><div className="login-logo"><img src="/toro-gold-isotipo.svg" alt="Isotipo TORO GOLD"/></div><div className="login-brand">TORO GOLD</div><div className="login-subtitle">ESCÁNER INTELIGENTE</div><div className="login-divider"/><h1>Bienvenido</h1><p>Ingresa tu contraseña para acceder al escáner y consultar los precios de nuestros productos.</p><form className="login-form" onSubmit={login}><label htmlFor="portal-password">Contraseña de acceso</label><input id="portal-password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Ingresa tu contraseña"/><button disabled={authBusy}>{authBusy?'Verificando…':'Ingresar al portal'}</button></form>{authError&&<div className="error" role="alert">{authError}</div>}<small className="login-foot">ACCESO EXCLUSIVO · TORO GOLD</small></section></main>;
 return <main><header className="topbar"><div className="brand-lockup"><div className="brand-mark"><img src="/toro-gold-isotipo.svg" alt="Isotipo oficial TORO GOLD"/></div><div className="brand-words"><strong>TORO GOLD</strong><span>JOYERÍA EXCLUSIVA</span></div></div><button className="logout-button" onClick={logout}>Cerrar sesión</button></header><section className="panel"><div className="eyebrow"><span className="eyebrow-line"/>HERRAMIENTA DE CONSULTA</div><h1>Escáner de <em>referencias</em></h1><p className="intro">Enfoca una sola etiqueta completa, con la referencia encima del precio. El sistema identifica la referencia y consulta Effi automáticamente.</p>
 <div className="camera"><video ref={video} playsInline muted autoPlay/><div className={'target '+(paused?'target-success':'')}><span>{paused?'LECTURA COMPLETADA':'ENFOCA REFERENCIA + PRECIO'}</span></div>{!active&&<div className="placeholder">Activa la cámara para comenzar</div>}</div>
 <div className="recognition"><div className="recognition-label">LECTURA EN TIEMPO REAL</div><div className="recognition-value" aria-live="polite">{recognized}</div><div className="status">{loading?'Consultando…':status}</div></div>
 <div className="sound-row"><span>Confirmación sonora al encontrar un producto</span><button type="button" className="sound-toggle" aria-pressed={soundEnabled} onClick={()=>{unlockAudio();setSoundEnabled(v=>!v)}}>{soundEnabled?'🔊 Sonido activado':'🔇 Sonido desactivado'}</button></div><div className="buttons"><button onClick={active?stop:start}>{active?'Detener cámara':'Iniciar cámara'}</button><button className="secondary" onClick={next}>{paused?'Escanear siguiente':'Reiniciar lectura'}</button></div>
 <form onSubmit={e=>{e.preventDefault();next();setRecognized(normalize(manual));lookup(manual)}}><label htmlFor="manual">Consulta manual</label><div className="manual"><input id="manual" value={manual} onChange={e=>setManual(e.target.value)} placeholder="Escribe la referencia"/><button disabled={loading}>Consultar</button></div></form>
 {error&&<div className="error" role="alert">{error}</div>}
 {item&&<article className="result"><div className="found">✓ PRODUCTO ENCONTRADO</div>{item.url_foto&&<img src={item.url_foto} alt="Producto"/>}<div className="product-detail"><div className="detail-label">DESCRIPCIÓN</div><h2>{item.descripcion||'Producto sin descripción'}</h2><div className="line"><span>Referencia</span><strong>{item.referencia}</strong></div><div className="line"><span>Categoría</span><strong>{item.nombre_categoria||'Sin categoría'}</strong></div></div><div className="price-grid"><div className="price-card retail"><div className="price-label">PRECIO DETAL</div><div className="price-amount">{formatPrecio(parseTarifas(item.precios_venta).detal)}</div></div><div className="price-card wholesale"><div className="price-label">PRECIO POR MAYOR</div><div className="price-amount">{formatPrecio(parseTarifas(item.precios_venta).mayor)}</div></div></div><button className="next" onClick={next}>Escanear siguiente producto</button></article>}
 </section><footer><img src="/toro-gold-isotipo.svg" alt="TORO GOLD"/><span>TORO GOLD <b>·</b> JOYERÍA EXCLUSIVA</span><small>Escáner inteligente · Consulta de solo lectura</small></footer></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
