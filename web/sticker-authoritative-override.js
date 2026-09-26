import { CORNER_FACELETS, EDGE_FACELETS, isCentreFacelet, labelForFacelet } from "./sticker-constraints-v2.js";

const clone=value=>value==null?value:structuredClone(value);

function normaliseRotation(value){return((Number(value)||0)%4+4)%4;}

function pieceInfo(facelet){
  const tile=Number(facelet);
  let index=EDGE_FACELETS.findIndex(piece=>piece.includes(tile));
  if(index>=0)return{family:"edge",index,tiles:EDGE_FACELETS[index]};
  index=CORNER_FACELETS.findIndex(piece=>piece.includes(tile));
  if(index>=0)return{family:"corner",index,tiles:CORNER_FACELETS[index]};
  return null;
}

function pieceKey(facelet){
  const info=pieceInfo(facelet);
  return info?`${info.family}:${info.index}`:null;
}

function dropTile(state,tile,removed,reason){
  const hard=state.confirmations?.[tile];
  const soft=state.ambiguities?.[tile];
  if(hard||soft){
    removed.push({tile:Number(tile),target:Number((hard||soft).target),reason,kind:hard?"confirmed":"ambiguous"});
  }
  delete state.confirmations?.[tile];
  delete state.ambiguities?.[tile];
}

function dropPiece(state,info,removed,reason){
  for(const tile of info?.tiles||[])dropTile(state,tile,removed,reason);
}

export function compatibleReferenceTargets(photoTile){
  const source=pieceInfo(photoTile);
  if(!source)return[];
  const pieces=source.family==="edge"?EDGE_FACELETS:CORNER_FACELETS;
  return pieces.flat().slice().sort((a,b)=>a-b);
}

export function describeOverrideRemoval(item){
  if(!item)return"";
  const target=Number.isInteger(Number(item.target))?`→${labelForFacelet(item.target)}`:"";
  return`${labelForFacelet(item.tile)}${target}`;
}

export function prepareAuthoritativeOverride({confirmations={},ambiguities={},tile,target,rotation=0}={}){
  const photo=Number(tile),reference=Number(target),quarter=normaliseRotation(rotation);
  if(!Number.isInteger(photo)||photo<0||photo>=54||isCentreFacelet(photo))return{ok:false,message:"Choose a non-centre photographed sticker."};
  if(!Number.isInteger(reference)||reference<0||reference>=54||isCentreFacelet(reference))return{ok:false,message:"Choose a non-centre reference sticker."};
  const source=pieceInfo(photo),destination=pieceInfo(reference);
  if(!source||!destination||source.family!==destination.family){
    return{ok:false,message:`${labelForFacelet(photo)} is a ${source?.family||"non-centre"} sticker, so it can only override a reference sticker of the same cubie type.`};
  }

  const state={confirmations:clone(confirmations)||{},ambiguities:clone(ambiguities)||{}};
  const removed=[];

  // This answer is authoritative for the physical cubie. Any older answers on
  // the same physical cubie are released so they cannot veto the new fact.
  for(const sibling of source.tiles){
    if(sibling!==photo)dropTile(state,sibling,removed,"same physical cubie");
  }
  dropTile(state,photo,removed,"replaced by authoritative override");

  // A solved cubie identity can only be occupied once. If another photographed
  // cubie currently claims any sticker belonging to this target cubie, release
  // that entire photographed cubie rather than leaving half of a stale claim.
  const collidingPieceKeys=new Set();
  for(const collection of[state.confirmations,state.ambiguities]){
    for(const[rawTile,value]of Object.entries(collection||{})){
      const otherTile=Number(rawTile);
      if(source.tiles.includes(otherTile))continue;
      const claimed=pieceInfo(Number(value?.target));
      if(claimed&&claimed.family===destination.family&&claimed.index===destination.index){
        const key=pieceKey(otherTile);if(key)collidingPieceKeys.add(key);
      }
    }
  }
  for(const key of collidingPieceKeys){
    const[family,indexText]=key.split(":"),index=Number(indexText),info={family,index,tiles:(family==="edge"?EDGE_FACELETS:CORNER_FACELETS)[index]};
    dropPiece(state,info,removed,"target cubie already claimed");
  }

  state.confirmations[photo]={target:reference,rotation:quarter};
  delete state.ambiguities[photo];
  return{ok:true,...state,removed,source,destination,authoritative:{tile:photo,target:reference,rotation:quarter}};
}

export function additionalConflictRelaxations(prepared){
  if(!prepared?.ok)return[];
  const sourceKey=`${prepared.source.family}:${prepared.source.index}`;
  const pieces=[];
  for(const family of["edge","corner"]){
    const table=family==="edge"?EDGE_FACELETS:CORNER_FACELETS;
    for(let index=0;index<table.length;index++){
      const key=`${family}:${index}`;
      if(key===sourceKey)continue;
      const tiles=table[index];
      const hardCount=tiles.reduce((sum,tile)=>sum+(prepared.confirmations?.[tile]?1:0),0);
      if(!hardCount)continue;
      pieces.push({family,index,tiles,hardCount,sameFamily:family===prepared.source.family});
    }
  }
  pieces.sort((a,b)=>Number(b.sameFamily)-Number(a.sameFamily)||a.hardCount-b.hardCount||a.index-b.index);
  return pieces.map(info=>{
    const state={confirmations:clone(prepared.confirmations)||{},ambiguities:clone(prepared.ambiguities)||{}};
    const removed=clone(prepared.removed)||[];
    dropPiece(state,info,removed,"additional mechanical conflict");
    return{...prepared,...state,removed,relaxedPiece:info};
  });
}
