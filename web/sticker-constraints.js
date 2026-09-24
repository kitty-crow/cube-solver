export const FACE_NAMES=["U","R","F","D","L","B"];
export const CENTRE_FACELETS=[4,13,22,31,40,49];
export const EDGE_FACELETS=[
  [5,10],[7,19],[3,37],[1,46],
  [32,16],[28,25],[30,43],[34,52],
  [23,12],[21,41],[50,39],[48,14],
];
export const CORNER_FACELETS=[
  [8,9,20],[6,18,38],[0,36,47],[2,45,11],
  [29,26,15],[27,44,24],[33,53,42],[35,17,51],
];

const EDGE_HOME=[[0,1],[0,2],[0,4],[0,5],[3,1],[3,2],[3,4],[3,5],[2,1],[2,4],[5,4],[5,1]];
const CORNER_HOME=[[0,1,2],[0,2,4],[0,4,5],[0,5,1],[3,2,1],[3,4,2],[3,5,4],[3,1,5]];
const FACE_NORMAL=[[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
const FACE_RIGHT=[[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
const FACE_UP=[[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];
const COUNT_CAP=1_000_000_000;

const centreSet=new Set(CENTRE_FACELETS);
const faceOf=(facelet)=>Math.floor(Number(facelet)/9);
const neg=(a)=>[-a[0],-a[1],-a[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];
const popcount=(value)=>{let v=value>>>0,n=0;while(v){v&=v-1;n++;}return n;};
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));

export function labelForFacelet(facelet){
  const value=Number(facelet);
  return `${FACE_NAMES[Math.floor(value/9)]}${value%9}`;
}
export function isCentreFacelet(facelet){return centreSet.has(Number(facelet));}

function matVec(m,v){return[dot(m[0],v),dot(m[1],v),dot(m[2],v)];}
function rotationForMapping(mapping){
  const items=Object.entries(mapping).map(([s,t])=>[Number(s),Number(t)]);
  if(items.length<2)return null;
  const [s1,t1]=items[0],[s2,t2]=items[1];
  const a1=FACE_NORMAL[s1],a2=FACE_NORMAL[s2],b1=FACE_NORMAL[t1],b2=FACE_NORMAL[t2];
  if(dot(a1,a2)!==0||dot(b1,b2)!==0)return null;
  const a3=cross(a1,a2),b3=cross(b1,b2),A=[a1,a2,a3],B=[b1,b2,b3];
  const m=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>
    B[0][i]*A[0][j]+B[1][i]*A[1][j]+B[2][i]*A[2][j]
  ));
  for(const [sf,tf] of items)if(!same(matVec(m,FACE_NORMAL[sf]),FACE_NORMAL[tf]))return null;
  return m;
}
function tileRotation(sourceFace,targetFace,rotation){
  const mappedUp=matVec(rotation,FACE_UP[sourceFace]),up=FACE_UP[targetFace],right=FACE_RIGHT[targetFace];
  if(same(mappedUp,up))return 0;
  if(same(mappedUp,right))return 1;
  if(same(mappedUp,neg(up)))return 2;
  if(same(mappedUp,neg(right)))return 3;
  throw new Error("Sticker up vector did not map into target face basis");
}
function permutations(values){
  if(values.length<=1)return [values.slice()];
  const out=[];
  for(let i=0;i<values.length;i++){
    const head=values[i],rest=values.slice(0,i).concat(values.slice(i+1));
    for(const tail of permutations(rest))out.push([head,...tail]);
  }
  return out;
}

function buildEdgeCandidates(){
  const domains=Array.from({length:12},()=>[]);
  for(let current=0;current<12;current++){
    const currentFaces=EDGE_FACELETS[current].map(faceOf);
    for(let home=0;home<12;home++){
      const homeFaces=EDGE_HOME[home];
      for(const orientation of[0,1]){
        const mapped=orientation===0?homeFaces:[homeFaces[1],homeFaces[0]];
        const rotation=rotationForMapping({[currentFaces[0]]:mapped[0],[currentFaces[1]]:mapped[1]});
        if(!rotation)continue;
        const placements=[];
        for(let j=0;j<2;j++){
          const targetFace=mapped[j],targetSlot=homeFaces.indexOf(targetFace);
          placements.push({
            tile:EDGE_FACELETS[current][j],
            target:EDGE_FACELETS[home][targetSlot],
            targetFace,
            rotation:tileRotation(currentFaces[j],targetFace,rotation),
          });
        }
        domains[current].push({id:`e:${current}:${home}:${orientation}`,family:"edge",current,home,orientation,placements});
      }
    }
  }
  return domains;
}
function buildCornerCandidates(){
  const domains=Array.from({length:8},()=>[]);
  for(let current=0;current<8;current++){
    const currentFaces=CORNER_FACELETS[current].map(faceOf);
    for(let home=0;home<8;home++){
      const homeFaces=CORNER_HOME[home],seen=new Set();
      for(const mapped of permutations(homeFaces)){
        const rotation=rotationForMapping({
          [currentFaces[0]]:mapped[0],
          [currentFaces[1]]:mapped[1],
          [currentFaces[2]]:mapped[2],
        });
        if(!rotation)continue;
        const orientation=mapped.findIndex(face=>face===0||face===3);
        if(seen.has(orientation))continue;
        seen.add(orientation);
        const placements=[];
        for(let j=0;j<3;j++){
          const targetFace=mapped[j],targetSlot=homeFaces.indexOf(targetFace);
          placements.push({
            tile:CORNER_FACELETS[current][j],
            target:CORNER_FACELETS[home][targetSlot],
            targetFace,
            rotation:tileRotation(currentFaces[j],targetFace,rotation),
          });
        }
        domains[current].push({id:`c:${current}:${home}:${orientation}`,family:"corner",current,home,orientation,placements});
      }
    }
  }
  return domains;
}

const ALL_EDGE_CANDIDATES=buildEdgeCandidates();
const ALL_CORNER_CANDIDATES=buildCornerCandidates();

function normaliseConfirmations(input={}){
  const out={};
  for(const [rawTile,value] of Object.entries(input||{})){
    const tile=Number(rawTile),target=Number(value?.target),rotation=((Number(value?.rotation)||0)%4+4)%4;
    if(!Number.isInteger(tile)||tile<0||tile>=54||isCentreFacelet(tile))continue;
    if(!Number.isInteger(target)||target<0||target>=54||isCentreFacelet(target))continue;
    out[tile]={target,rotation};
  }
  return out;
}
function duplicateTarget(confirmations){
  const seen=new Map();
  for(const [tileText,value] of Object.entries(confirmations)){
    const tile=Number(tileText),old=seen.get(value.target);
    if(old!=null&&old!==tile)return{target:value.target,tiles:[old,tile]};
    seen.set(value.target,tile);
  }
  return null;
}
function filterFamily(allDomains,confirmations){
  const targetClaims=new Map(Object.entries(confirmations).map(([tile,value])=>[Number(value.target),Number(tile)]));
  return allDomains.map(candidates=>candidates.filter(candidate=>candidate.placements.every(placement=>{
    const own=confirmations[placement.tile];
    if(own&&(own.target!==placement.target||own.rotation!==placement.rotation))return false;
    const claimant=targetClaims.get(placement.target);
    return claimant==null||claimant===placement.tile;
  })));
}
function greaterUsedParity(usedMask,home,size){
  const full=(1<<size)-1,greater=usedMask&(~((1<<(home+1))-1))&full;
  return popcount(greater)&1;
}
function familyCount(domains,modulus,requiredParity,forcedCandidate=null,cap=COUNT_CAP){
  const size=domains.length,memo=new Map();
  function walk(index,usedMask,orientationSum,parity){
    if(index===size)return orientationSum%modulus===0&&parity===requiredParity?1:0;
    const key=`${index}|${usedMask}|${orientationSum}|${parity}`;
    if(memo.has(key))return memo.get(key);
    let total=0;
    const choices=forcedCandidate&&forcedCandidate.current===index?[forcedCandidate]:domains[index];
    for(const candidate of choices){
      if(usedMask&(1<<candidate.home))continue;
      const nextParity=parity^greaterUsedParity(usedMask,candidate.home,size);
      total+=walk(index+1,usedMask|(1<<candidate.home),(orientationSum+candidate.orientation)%modulus,nextParity);
      if(total>=cap){total=cap;break;}
    }
    memo.set(key,total);
    return total;
  }
  return walk(0,0,0,0);
}
function familyExists(domains,modulus,requiredParity,forcedCandidate=null){
  const size=domains.length,memo=new Map();
  function walk(index,usedMask,orientationSum,parity){
    if(index===size)return orientationSum%modulus===0&&parity===requiredParity;
    const key=`${index}|${usedMask}|${orientationSum}|${parity}`;
    if(memo.has(key))return memo.get(key);
    const choices=forcedCandidate&&forcedCandidate.current===index?[forcedCandidate]:domains[index];
    for(const candidate of choices){
      if(usedMask&(1<<candidate.home))continue;
      const nextParity=parity^greaterUsedParity(usedMask,candidate.home,size);
      if(walk(index+1,usedMask|(1<<candidate.home),(orientationSum+candidate.orientation)%modulus,nextParity)){
        memo.set(key,true);return true;
      }
    }
    memo.set(key,false);return false;
  }
  return walk(0,0,0,0);
}
function findFamilySolution(domains,modulus,requiredParity){
  const size=domains.length,chosen=new Array(size),dead=new Set();
  function walk(index,usedMask,orientationSum,parity){
    if(index===size)return orientationSum%modulus===0&&parity===requiredParity;
    const key=`${index}|${usedMask}|${orientationSum}|${parity}`;
    if(dead.has(key))return false;
    for(const candidate of domains[index]){
      if(usedMask&(1<<candidate.home))continue;
      chosen[index]=candidate;
      const nextParity=parity^greaterUsedParity(usedMask,candidate.home,size);
      if(walk(index+1,usedMask|(1<<candidate.home),(orientationSum+candidate.orientation)%modulus,nextParity))return true;
    }
    dead.add(key);return false;
  }
  return walk(0,0,0,0)?chosen.slice():null;
}
function supportedCandidates(domains,modulus,otherParityCounts){
  return domains.map(candidates=>candidates.filter(candidate=>{
    for(let parity=0;parity<2;parity++){
      if(otherParityCounts[parity]<=0)continue;
      if(familyExists(domains,modulus,parity,candidate))return true;
    }
    return false;
  }));
}
function saturatingProduct(a,b){return Math.min(COUNT_CAP,a*b);}
function saturatingAdd(a,b){return Math.min(COUNT_CAP,a+b);}

function decodeScores(encoded,expected){
  if(typeof encoded!=="string"||!encoded)return null;
  try{
    const binary=atob(encoded),buffer=new ArrayBuffer(binary.length),bytes=new Uint8Array(buffer);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const view=new DataView(buffer),out=new Float32Array(expected);
    for(let i=0;i<expected;i++)out[i]=view.getFloat32(i*4,true);
    return out;
  }catch(_){return null;}
}
function visualScore(scores,tile,target,rotation){
  if(!scores)return 0;
  const index=(tile*4+(rotation%4))*54+target;
  const value=Number(scores[index]);
  return Number.isFinite(value)?value:0;
}
function placementsForTile(tile,supportedEdges,supportedCorners){
  const source=EDGE_FACELETS.some(piece=>piece.includes(tile))?supportedEdges:supportedCorners;
  const current=source.findIndex((_,index)=>{
    const piece=source===supportedEdges?EDGE_FACELETS[index]:CORNER_FACELETS[index];
    return piece.includes(tile);
  });
  if(current<0)return[];
  const unique=new Map();
  for(const candidate of source[current]){
    const placement=candidate.placements.find(item=>item.tile===tile);
    if(!placement)continue;
    const key=`${placement.target}:${placement.rotation}`;
    if(!unique.has(key))unique.set(key,{target:placement.target,rotation:placement.rotation});
  }
  return[...unique.values()];
}
function resolvedPayload(edgeDomains,cornerDomains,edgeCounts,cornerCounts,confirmations,centerRotations){
  let parity=-1;
  for(let p=0;p<2;p++)if(edgeCounts[p]===1&&cornerCounts[p]===1){parity=p;break;}
  if(parity<0)return null;
  const edges=findFamilySolution(edgeDomains,2,parity),corners=findFamilySolution(cornerDomains,3,parity);
  if(!edges||!corners)return null;
  const state=Array.from({length:54},(_,i)=>FACE_NAMES[Math.floor(i/9)]),placements={};
  for(const centre of CENTRE_FACELETS)placements[centre]={target:centre,rotation:Number(centerRotations?.[Math.floor(centre/9)]||0),source:"centre"};
  for(const candidate of[...edges,...corners])for(const placement of candidate.placements){
    state[placement.tile]=FACE_NAMES[placement.targetFace];
    placements[placement.tile]={
      target:placement.target,
      rotation:placement.rotation,
      source:confirmations[placement.tile]?"confirmed":"inferred",
    };
  }
  return{
    version:1,
    resolved:true,
    state:state.join(""),
    center_rotations:Array.from({length:6},(_,face)=>((Number(centerRotations?.[face])||0)%4+4)%4),
    placements,
    confirmed:structuredClone(confirmations),
    legal_state_count:1,
  };
}

export function analyseStickerConstraints({confirmations={},absoluteF32B64="",centerRotations=[]}={}){
  const hard=normaliseConfirmations(confirmations),duplicate=duplicateTarget(hard);
  if(duplicate){
    return{ok:false,conflict:`${labelForFacelet(duplicate.target)} is already assigned to another photographed sticker.`,confirmations:hard,legalStateCount:0};
  }
  const edgeDomains=filterFamily(ALL_EDGE_CANDIDATES,hard),cornerDomains=filterFamily(ALL_CORNER_CANDIDATES,hard);
  if(edgeDomains.some(domain=>!domain.length)||cornerDomains.some(domain=>!domain.length)){
    return{ok:false,conflict:"The confirmed sticker assignments leave a physical cubie with no legal identity/orientation.",confirmations:hard,legalStateCount:0};
  }

  const edgeCounts=[familyCount(edgeDomains,2,0),familyCount(edgeDomains,2,1)];
  const cornerCounts=[familyCount(cornerDomains,3,0),familyCount(cornerDomains,3,1)];
  const legalStateCount=saturatingAdd(saturatingProduct(edgeCounts[0],cornerCounts[0]),saturatingProduct(edgeCounts[1],cornerCounts[1]));
  if(!legalStateCount){
    return{ok:false,conflict:"These confirmations cannot occur on one legal 3×3 cube. Unassign one of the conflicting stickers.",confirmations:hard,legalStateCount:0,edgeCounts,cornerCounts};
  }

  const supportedEdges=supportedCandidates(edgeDomains,2,cornerCounts),supportedCorners=supportedCandidates(cornerDomains,3,edgeCounts);
  const scores=decodeScores(absoluteF32B64,54*4*54),stickers={},unresolved=[];
  let confirmedCount=0,inferredCount=0,unresolvedCount=0;
  for(let tile=0;tile<54;tile++){
    if(isCentreFacelet(tile))continue;
    const domain=placementsForTile(tile,supportedEdges,supportedCorners).map(option=>({...option,score:visualScore(scores,tile,option.target,option.rotation)}));
    domain.sort((a,b)=>b.score-a.score||a.target-b.target||a.rotation-b.rotation);
    const explicit=hard[tile]||null;
    let status="unresolved";
    if(explicit){status="confirmed";confirmedCount++;}
    else if(domain.length===1){status="inferred";inferredCount++;}
    else{unresolvedCount++;}
    const best=domain[0]?.score||0,second=domain[1]?.score??best;
    const ambiguity=domain.length<=1?0:1-clamp((best-second)/0.12);
    const entropy=domain.length<=1?0:clamp(Math.log2(domain.length)/5);
    const priority=.72*ambiguity+.28*entropy;
    stickers[tile]={
      tile,
      label:labelForFacelet(tile),
      status,
      confirmed:explicit,
      domain,
      priority,
      best:domain[0]||null,
    };
    if(status==="unresolved")unresolved.push(stickers[tile]);
  }
  unresolved.sort((a,b)=>b.priority-a.priority||b.domain.length-a.domain.length||a.tile-b.tile);
  const resolved=legalStateCount===1?resolvedPayload(edgeDomains,cornerDomains,edgeCounts,cornerCounts,hard,centerRotations):null;
  return{
    ok:true,
    confirmations:hard,
    legalStateCount,
    legalStateCountCapped:legalStateCount>=COUNT_CAP,
    edgeCounts,
    cornerCounts,
    confirmedCount,
    inferredCount:resolved?48-confirmedCount:inferredCount,
    unresolvedCount:resolved?0:unresolvedCount,
    stickers,
    nextTile:resolved?null:(unresolved[0]?.tile??null),
    resolved,
  };
}
