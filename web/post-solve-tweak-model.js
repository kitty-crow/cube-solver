import {
  analyseStickerConstraints,
  CENTRE_FACELETS,
  EDGE_FACELETS,
  CORNER_FACELETS,
  labelForFacelet,
} from "./sticker-constraints-v3.js";

export const FACE_NAMES=["U","R","F","D","L","B"];
export const CENTRES=new Set(CENTRE_FACELETS.map(Number));

const PIECES=[
  ...EDGE_FACELETS.map((tiles,i)=>({key:`E${i}`,kind:"edge",tiles:tiles.map(Number)})),
  ...CORNER_FACELETS.map((tiles,i)=>({key:`C${i}`,kind:"corner",tiles:tiles.map(Number)})),
];
const BY_KEY=new Map(PIECES.map(piece=>[piece.key,piece]));
const BY_TILE=new Map();
for(const piece of PIECES)for(const tile of piece.tiles)BY_TILE.set(tile,piece);

export const mod4=value=>((Number(value)||0)%4+4)%4;
export const uiToGeometry=quarterTurns=>(4-mod4(quarterTurns))%4;

export function kindOfTile(tile){
  const value=Number(tile);
  if(CENTRES.has(value))return"centre";
  return BY_TILE.get(value)?.kind||"unknown";
}

export function pieceForTile(tile){
  const value=Number(tile);
  if(CENTRES.has(value))return{key:`M${Math.floor(value/9)}`,kind:"centre",tiles:[value]};
  const piece=BY_TILE.get(value);
  return piece?{key:piece.key,kind:piece.kind,tiles:piece.tiles.slice()}:null;
}

export function pieceByKey(key){
  const value=String(key||"");
  if(/^M[0-5]$/.test(value)){
    const face=Number(value.slice(1));
    return{key:value,kind:"centre",tiles:[face*9+4]};
  }
  const piece=BY_KEY.get(value);
  return piece?{key:piece.key,kind:piece.kind,tiles:piece.tiles.slice()}:null;
}

export function pieceLabel(tileOrKey){
  const piece=typeof tileOrKey==="string"?pieceByKey(tileOrKey):pieceForTile(tileOrKey);
  if(!piece)return"Unknown cubie";
  if(piece.kind==="centre")return`${labelForFacelet(piece.tiles[0])} centre`;
  return`${piece.tiles.map(labelForFacelet).join(" / ")} ${piece.kind}`;
}

export function compatibleTarget(source,target){
  const sourceKind=kindOfTile(source),targetKind=kindOfTile(target);
  return sourceKind==="centre"
    ? Number(source)===Number(target)
    : (sourceKind==="edge"||sourceKind==="corner")&&sourceKind===targetKind;
}

export function candidateTargets(tile){
  const kind=kindOfTile(tile);
  if(kind==="centre")return[Number(tile)];
  const source=kind==="edge"?EDGE_FACELETS:kind==="corner"?CORNER_FACELETS:[];
  return source.flat().map(Number).sort((a,b)=>a-b);
}

function requestsMap(input){
  const entries=input instanceof Map?[...input]:Object.entries(input||{}),out=new Map();
  for(const[sourceRaw,request]of entries){
    const source=Number(sourceRaw),target=Number(request?.target);
    if(Number.isInteger(source)&&Number.isInteger(target)&&!CENTRES.has(source)&&compatibleTarget(source,target)){
      out.set(source,{target,rotation:mod4(request?.rotation)});
    }
  }
  return out;
}

function unlockedSet(input){
  const out=new Set();
  for(const raw of input||[]){
    const key=typeof raw==="number"?pieceForTile(raw)?.key:String(raw||"");
    const piece=pieceByKey(key);
    if(piece&&piece.kind!=="centre")out.add(piece.key);
  }
  return out;
}

function centresArray(input){
  const raw=Array.from(input||[]);
  return Array.from({length:6},(_,index)=>mod4(raw[index]||0));
}

export function buildTweakConstraints({requests=new Map(),unlockedPieces=new Set(),centerRotations=[]}={}){
  const normalisedRequests=requestsMap(requests);
  const unlocked=unlockedSet(unlockedPieces);
  const centres=centresArray(centerRotations);

  // A user's correction is authoritative. Its source cubie and the cubie that
  // currently owns the requested reference identity must be free to move.
  for(const[source,request]of normalisedRequests){
    const sourcePiece=pieceForTile(source),targetPiece=pieceForTile(request.target);
    if(sourcePiece?.kind!=="centre")unlocked.add(sourcePiece.key);
    if(targetPiece?.kind!=="centre")unlocked.add(targetPiece.key);
  }

  const confirmations={};
  for(const piece of PIECES){
    if(unlocked.has(piece.key))continue;
    for(const tile of piece.tiles)confirmations[tile]={target:tile,rotation:0};
  }
  for(const[source,request]of normalisedRequests){
    confirmations[source]={target:request.target,rotation:uiToGeometry(request.rotation)};
  }

  const analysis=analyseStickerConstraints({confirmations,ambiguities:{},centerRotations:centres});
  return{analysis,confirmations,requests:normalisedRequests,unlockedPieces:unlocked,centerRotations:centres};
}

function preference(tile,option){
  const target=Number(option?.target),rotation=mod4(option?.rotation);
  const identity=target===Number(tile)&&rotation===0?0:target===Number(tile)?1:2;
  return identity*100+Math.min(rotation,4-rotation)*10-Number(option?.score||0);
}

function nextSticker(analysis,unlocked,explicit){
  const choices=[];
  for(const sticker of Object.values(analysis?.stickers||{})){
    const tile=Number(sticker?.tile),piece=pieceForTile(tile),domain=Array.isArray(sticker?.domain)?sticker.domain:[];
    if(piece&&unlocked.has(piece.key)&&!explicit.has(tile)&&domain.length>1)choices.push({tile,domain});
  }
  choices.sort((a,b)=>a.domain.length-b.domain.length||a.tile-b.tile);
  return choices[0]||null;
}

function completeFromBase(base){
  if(!base.analysis?.ok||Number(base.analysis.legalStateCount||0)<=0){
    return{...base,completion:null,autoAssignments:[]};
  }

  let analysis=base.analysis;
  const confirmations={...base.confirmations};
  const explicit=new Set([...base.requests.keys()]);
  const autoAssignments=[];

  for(let guard=0;Number(analysis.legalStateCount||0)>1&&guard<64;guard++){
    const candidate=nextSticker(analysis,base.unlockedPieces,explicit);
    if(!candidate)break;
    const option=[...candidate.domain].sort((a,b)=>
      preference(candidate.tile,a)-preference(candidate.tile,b)||
      Number(a.target)-Number(b.target)||
      Number(a.rotation)-Number(b.rotation)
    )[0];
    if(!option)break;
    confirmations[candidate.tile]={target:Number(option.target),rotation:mod4(option.rotation)};
    autoAssignments.push({tile:candidate.tile,target:Number(option.target),rotation:mod4(option.rotation)});
    analysis=analyseStickerConstraints({confirmations,ambiguities:{},centerRotations:base.centerRotations});
    if(!analysis?.ok)break;
  }

  const exact=Boolean(analysis?.ok&&Number(analysis.legalStateCount)===1&&analysis.resolved?.resolved);
  return{...base,analysis,confirmations,completion:exact?analysis.resolved:null,autoAssignments};
}

function combinations(values,count,start=0,prefix=[],out=[]){
  if(prefix.length===count){out.push(prefix.slice());return out;}
  for(let index=start;index<=values.length-(count-prefix.length);index++){
    prefix.push(values[index]);
    combinations(values,count,index+1,prefix,out);
    prefix.pop();
  }
  return out;
}

function completionDisruption(bundle,autoUnlocked){
  const changedAssignments=(bundle.autoAssignments||[]).filter(item=>
    Number(item.target)!==Number(item.tile)||mod4(item.rotation)!==0
  ).length;
  const rotations=(bundle.autoAssignments||[]).reduce((sum,item)=>sum+Math.min(mod4(item.rotation),4-mod4(item.rotation)),0);
  return[autoUnlocked.length,changedAssignments,rotations,Number(bundle.analysis?.legalStateCount||0)];
}

function compareTuple(a,b){
  for(let index=0;index<Math.max(a.length,b.length);index++){
    const left=Number(a[index]||0),right=Number(b[index]||0);
    if(left!==right)return left-right;
  }
  return 0;
}

export function completeTweakTarget(input={}){
  const initialBase=buildTweakConstraints(input);
  const initial=completeFromBase(initialBase);
  if(initial.completion)return{...initial,autoUnlockedPieces:[]};

  const alreadyUnlocked=new Set(initialBase.unlockedPieces);
  const candidates=PIECES.filter(piece=>!alreadyUnlocked.has(piece.key)).map(piece=>piece.key);
  let best=null;

  // A correction supplied here is new ground truth about the real cube. If it
  // contradicts the old "solved" reconstruction, release the smallest possible
  // number of old assumptions automatically instead of rejecting the correction.
  for(const releaseCount of[1,2]){
    for(const extraKeys of combinations(candidates,releaseCount)){
      const unlocked=new Set([...(input.unlockedPieces||[]),...extraKeys]);
      const candidate=completeFromBase(buildTweakConstraints({...input,unlockedPieces:unlocked}));
      if(!candidate.completion)continue;
      const score=completionDisruption(candidate,extraKeys);
      if(!best||compareTuple(score,best.score)<0){
        best={bundle:candidate,extraKeys:extraKeys.slice(),score};
      }
    }
    if(best)break;
  }

  if(best){
    return{...best.bundle,autoUnlockedPieces:best.extraKeys};
  }
  return{...initial,autoUnlockedPieces:[]};
}

export function hasUserTweaks({requests=new Map(),unlockedPieces=new Set(),centerRotations=[]}={}){
  const requestCount=requests instanceof Map?requests.size:Object.keys(requests||{}).length;
  return requestCount>0||[...unlockedPieces||[]].length>0||centresArray(centerRotations).some(Boolean);
}
