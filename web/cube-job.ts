import { loadScan, saveScan } from "./scan-store.js";
import { buildPayloadFromCaptures } from "./scan-geometry.js";
import { clearReferenceSession, exportReferenceSession, importReferenceSession } from "./reference-session.js";

const FACE_ORDER=["F","R","B","L","U","D"];
const TILE_SIZE=48;
const ROUNDED_SETTING="picture-cube-rounded-cubies";
const MODE_SETTING="picture-cube-mode";
const FORMAT="picture-cube-job";
const FORMAT_VERSION=1;
const TAR_BLOCK=512;
const encoder=new TextEncoder();
const decoder=new TextDecoder();

function canvasBlob(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not encode captured face")),"image/png"));
}

async function blobCanvas(blob){
  const bitmap=await createImageBitmap(blob);
  try{
    const canvas=document.createElement("canvas");
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    canvas.getContext("2d",{alpha:false}).drawImage(bitmap,0,0);
    return canvas;
  }finally{bitmap.close?.();}
}

function asciiWrite(target,offset,length,text){
  const bytes=encoder.encode(String(text));
  target.set(bytes.subarray(0,length),offset);
}

function octal(value,length){
  const text=Math.max(0,Math.floor(Number(value)||0)).toString(8);
  return `${text.padStart(Math.max(1,length-1),"0").slice(-(length-1))}\0`;
}

function tarHeader(name,size,mtime=Math.floor(Date.now()/1000)){
  if(encoder.encode(name).length>100)throw new Error(`Archive path is too long: ${name}`);
  const header=new Uint8Array(TAR_BLOCK);
  asciiWrite(header,0,100,name);
  asciiWrite(header,100,8,octal(0o644,8));
  asciiWrite(header,108,8,octal(0,8));
  asciiWrite(header,116,8,octal(0,8));
  asciiWrite(header,124,12,octal(size,12));
  asciiWrite(header,136,12,octal(mtime,12));
  for(let i=148;i<156;i++)header[i]=32;
  header[156]="0".charCodeAt(0);
  asciiWrite(header,257,6,"ustar\0");
  asciiWrite(header,263,2,"00");
  asciiWrite(header,265,32,"picture-cube");
  asciiWrite(header,297,32,"picture-cube");
  let sum=0;for(const byte of header)sum+=byte;
  asciiWrite(header,148,8,`${sum.toString(8).padStart(6,"0")}\0 `);
  return header;
}

function concatBytes(parts){
  const total=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(total);
  let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
}

async function makeTar(entries){
  const parts=[];
  for(const entry of entries){
    const data=entry.data instanceof Uint8Array?entry.data:new Uint8Array(await entry.data.arrayBuffer());
    parts.push(tarHeader(entry.name,data.length),data);
    const padding=(TAR_BLOCK-(data.length%TAR_BLOCK))%TAR_BLOCK;
    if(padding)parts.push(new Uint8Array(padding));
  }
  parts.push(new Uint8Array(TAR_BLOCK*2));
  return concatBytes(parts);
}

function parseOctal(bytes,start,length){
  const text=decoder.decode(bytes.subarray(start,start+length)).replace(/\0.*$/s,"").trim();
  return text?parseInt(text,8):0;
}

function parseTar(bytes){
  const entries=new Map();
  let offset=0;
  while(offset+TAR_BLOCK<=bytes.length){
    const header=bytes.subarray(offset,offset+TAR_BLOCK);
    if(header.every(byte=>byte===0))break;
    const name=decoder.decode(header.subarray(0,100)).replace(/\0.*$/s,"");
    const size=parseOctal(header,124,12);
    if(!name||size<0||offset+TAR_BLOCK+size>bytes.length)throw new Error("Invalid .cube tar archive");
    const start=offset+TAR_BLOCK;
    entries.set(name,bytes.slice(start,start+size));
    offset=start+Math.ceil(size/TAR_BLOCK)*TAR_BLOCK;
  }
  return entries;
}

async function gzip(bytes){
  if(typeof CompressionStream!=="function")throw new Error("This browser cannot create gzip archives.");
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes){
  if(typeof DecompressionStream!=="function")throw new Error("This browser cannot open gzip archives.");
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function jsonSafeSession(record){
  if(!record)return null;
  const copy=structuredClone(record);
  delete copy.referenceBlob;
  return copy;
}

async function cachedReferenceBlob(session){
  if(session?.referenceBlob instanceof Blob)return session.referenceBlob;
  const url=String(session?.remoteThumbnail||session?.candidate?.sourceUrl||session?.candidate?.thumbnailUrl||"");
  if(!url)return null;
  try{
    const response=await fetch(url,{mode:"cors"});
    return response.ok?await response.blob():null;
  }catch(_){return null;}
}

function referenceExtension(type){
  if(type==="image/png")return"png";
  if(type==="image/webp")return"webp";
  if(type==="image/gif")return"gif";
  return"jpg";
}

export async function buildCurrentCubeJob(){
  const scan=await loadScan();
  if(!scan||scan.captures.size!==6)throw new Error("Capture all six faces before downloading the job.");
  const rounded=localStorage.getItem(ROUNDED_SETTING)==="1";
  const cubeMode=localStorage.getItem(MODE_SETTING)==="solid-colour"?"solid-colour":"picture";
  const prepared=buildPayloadFromCaptures(scan.captures,scan.rotations,scan.size,TILE_SIZE,rounded);
  const session=cubeMode==="picture"?await exportReferenceSession(prepared.payload).catch(()=>null):null;
  const entries=[];
  const facePaths={};
  for(const face of FACE_ORDER){
    const canvas=scan.captures.get(face);
    if(!canvas)throw new Error(`Missing ${face} capture`);
    const path=`captures/${face}.png`;
    facePaths[face]=path;
    entries.push({name:path,data:await canvasBlob(canvas)});
  }

  let reference=null;
  if(session){
    const blob=await cachedReferenceBlob(session);
    if(!blob)throw new Error("The selected reference image is not cached yet, so the complete job cannot be exported.");
    const ext=referenceExtension(blob.type),path=`reference/reference.${ext}`;
    entries.push({name:path,data:blob});
    reference={
      imagePath:path,
      imageType:blob.type||"application/octet-stream",
      session:jsonSafeSession(session),
    };
  }

  const manifest={
    format:FORMAT,
    formatVersion:FORMAT_VERSION,
    exportedAt:new Date().toISOString(),
    scan:{
      size:Number(scan.size),
      cubeMode,
      roundedCubies:rounded,
      rotations:Object.fromEntries(scan.rotations),
      faces:facePaths,
    },
    reference,
  };
  entries.unshift({name:"job.json",data:encoder.encode(JSON.stringify(manifest,null,2))});
  const tar=await makeTar(entries),compressed=await gzip(tar);
  return new Blob([compressed],{type:"application/gzip"});
}

export async function downloadCurrentCubeJob(){
  const blob=await buildCurrentCubeJob();
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`picture-cube-${stamp}.cube`;link.style.display="none";
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function requireEntry(entries,path){
  const value=entries.get(path);if(!value)throw new Error(`Invalid .cube file: missing ${path}`);return value;
}

export async function loadCubeJob(file){
  if(!(file instanceof Blob))throw new Error("Choose a .cube file.");
  const compressed=new Uint8Array(await file.arrayBuffer());
  if(compressed[0]!==0x1f||compressed[1]!==0x8b)throw new Error("This .cube file is not a gzip-compressed cube job.");
  const entries=parseTar(await gunzip(compressed));
  const manifest=JSON.parse(decoder.decode(requireEntry(entries,"job.json")));
  if(manifest?.format!==FORMAT||Number(manifest.formatVersion)!==FORMAT_VERSION)throw new Error("Unsupported .cube job format.");
  const size=Number(manifest.scan?.size);
  if(![2,3,4].includes(size))throw new Error("Invalid cube size in job.");

  const captures=new Map();
  for(const face of FACE_ORDER){
    const path=manifest.scan?.faces?.[face];
    if(!path)throw new Error(`Invalid .cube file: ${face} capture is missing from the manifest.`);
    const bytes=requireEntry(entries,path);
    captures.set(face,await blobCanvas(new Blob([bytes],{type:"image/png"})));
  }
  const rotations=new Map(FACE_ORDER.map(face=>[face,Number(manifest.scan?.rotations?.[face])||0]));
  const rounded=Boolean(manifest.scan?.roundedCubies);
  const requestedMode=manifest.scan?.cubeMode==="solid-colour"?"solid-colour":"picture";
  const cubeMode=requestedMode==="solid-colour"&&size===3?"solid-colour":"picture";
  localStorage.setItem(ROUNDED_SETTING,rounded?"1":"0");
  localStorage.setItem(MODE_SETTING,cubeMode);
  await saveScan(size,captures,rotations);

  const prepared=buildPayloadFromCaptures(captures,rotations,size,TILE_SIZE,rounded);
  if(cubeMode==="picture"&&manifest.reference?.session){
    const path=manifest.reference.imagePath;
    const bytes=requireEntry(entries,path);
    const referenceBlob=new Blob([bytes],{type:String(manifest.reference.imageType||"application/octet-stream")});
    await importReferenceSession(prepared.payload,manifest.reference.session,referenceBlob);
  }else if(cubeMode==="picture"){
    await clearReferenceSession();
  }
  return manifest;
}