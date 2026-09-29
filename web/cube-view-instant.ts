import * as THREE from "three";
import { CubeView } from "./cube-view.js";

const NORMAL={
  U:new THREE.Vector3(0,1,0),R:new THREE.Vector3(1,0,0),F:new THREE.Vector3(0,0,1),
  D:new THREE.Vector3(0,-1,0),L:new THREE.Vector3(-1,0,0),B:new THREE.Vector3(0,0,-1),
};

function parseMove(token){
  const match=String(token).trim().match(/^(\d+)?([URFDLB])([wW]?)(2|'?)$/);
  if(!match)throw new Error(`Unsupported move: ${token}`);
  const[,prefix,face,wide,suffix]=match;
  return{face,layers:wide?Number(prefix||2):1,turns:suffix==="2"?2:suffix==="'"?-1:1};
}
function snapCoord(value,size){const centre=(size-1)/2;return Math.round(value+centre)-centre;}

function applyInstant(view,token){
  const{face,layers,turns}=parseMove(token);
  if(layers>view.size)throw new Error(`Move ${token} exceeds ${view.size}×${view.size}`);
  const axis=NORMAL[face],centre=(view.size-1)/2,cutoff=centre-layers+.5,pivot=new THREE.Group();
  view.root.add(pivot);
  const selected=view.cubelets.filter(cubelet=>cubelet.position.dot(axis)>cutoff);
  for(const cubelet of selected)pivot.attach(cubelet);
  pivot.setRotationFromAxisAngle(axis,-turns*Math.PI/2);
  pivot.updateMatrixWorld(true);
  for(const cubelet of selected){
    view.root.attach(cubelet);
    cubelet.position.set(snapCoord(cubelet.position.x,view.size),snapCoord(cubelet.position.y,view.size),snapCoord(cubelet.position.z,view.size));
    const e=new THREE.Euler().setFromQuaternion(cubelet.quaternion,"XYZ"),q=Math.PI/2;
    e.set(Math.round(e.x/q)*q,Math.round(e.y/q)*q,Math.round(e.z/q)*q);
    cubelet.quaternion.setFromEuler(e);
  }
  view.root.remove(pivot);
}

const originalBuild=CubeView.prototype.build;
CubeView.prototype.build=function(...args){
  const result=originalBuild.apply(this,args);
  window.__activePictureCubeView=this;
  return result;
};

CubeView.prototype.showMovesInstant=function(tokens=[]){
  if(this.busy)return false;
  this.busy=true;
  try{for(const token of tokens||[])applyInstant(this,token);return true;}
  finally{this.busy=false;}
};
