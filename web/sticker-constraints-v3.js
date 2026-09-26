import { analyseStickerConstraints as analyseV2 } from "./sticker-constraints-v2.js";
export * from "./sticker-constraints-v2.js";

function hintStillUseful(sticker,hint){
  if(!sticker||!hint||!Array.isArray(sticker.domain))return false;
  if(sticker.domain.length<=1)return false;
  return sticker.domain.some(option=>Number(option.target)===Number(hint.target)&&Number(option.rotation)===Number(hint.rotation));
}

export function analyseStickerConstraints(input={}){
  let analysis=analyseV2(input);
  if(!analysis?.ok)return analysis;

  const supplied={...(input.ambiguities||{})};
  const cleaned={};
  let changed=false;
  for(const[rawTile,hint]of Object.entries(supplied)){
    const tile=Number(rawTile),sticker=analysis.stickers?.[tile];
    if(hintStillUseful(sticker,hint))cleaned[tile]=hint;
    else changed=true;
  }

  // A soft/ambiguous answer is evidence only. Once exact cube mechanics or a
  // stronger hard assignment makes that hint impossible (or mechanically
  // forces the sticker), discard the hint rather than allowing it to appear as
  // a locked assignment in the UI or solution payload.
  if(changed){
    analysis=analyseV2({...input,ambiguities:cleaned});
    if(!analysis?.ok)return analysis;
  }

  // A probable solution is ready to solve, but it is not the same thing as a
  // unique state. Keep offering the next unresolved/ambiguous sticker so the
  // user can continue improving it if they want.
  if(analysis.resolved&&!analysis.resolved.exact){
    const next=Object.values(analysis.stickers||{})
      .filter(sticker=>sticker.status==="unresolved"||sticker.status==="ambiguous")
      .sort((a,b)=>(a.status==="ambiguous")-(b.status==="ambiguous")||Number(b.priority||0)-Number(a.priority||0)||a.tile-b.tile)[0];
    analysis.nextTile=next?.tile??null;
  }
  return analysis;
}
