import { analyseStickerConstraints } from "./sticker-constraints-v2.js";

self.addEventListener("message",(event)=>{
  const data=event.data||{};
  if(data.type!=="analyse")return;
  try{
    const analysis=analyseStickerConstraints(data.input||{});
    postMessage({type:"analysis",requestId:data.requestId,analysis});
  }catch(error){
    postMessage({type:"error",requestId:data.requestId,message:error instanceof Error?error.message:String(error)});
  }
});
