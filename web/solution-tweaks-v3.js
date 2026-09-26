import "./solution-tweaks-v2.js";

const CONFLICT_COPY=
  "Your current correction remains authoritative. All non-authoritative solved-state assumptions have been released automatically. The fixed reference has not been changed. If a conflict remains, it is between observations already marked authoritative, not with this correction.";
const CALCULATE_COPY="Calculate legal moves";

function polishSolvedTweakUi(){
  const root=document.querySelector(".solution-tweak-modal");
  if(!root)return;

  // Releasing companion cubies is solver work now, not a question for the user.
  const unlock=root.querySelector("[data-tweak-unlock]");
  if(unlock)unlock.remove();

  // With the advanced escape hatch gone, keep the remaining secondary action
  // visually balanced rather than leaving an empty cell in the two-column grid.
  const source=root.querySelector("[data-tweak-source]");
  if(source)source.style.gridColumn="1 / -1";

  // Move playback belongs to the main 3D solution player. Keep the placeholder
  // element so the v2 editor can safely toggle it internally, but remove every
  // modal playback control and sequence display from the user interface.
  const playback=root.querySelector("[data-tweak-playback]");
  if(playback&&!playback.dataset.mainPlayerOnly){
    playback.replaceChildren();
    playback.hidden=true;
    playback.dataset.mainPlayerOnly="true";
  }

  // MutationObserver callbacks must be idempotent. Setting textContent even to
  // the same value emits another childList mutation in browsers and previously
  // created a self-sustaining observer loop as soon as this modal was opened.
  const calculate=root.querySelector("[data-tweak-calculate]");
  if(calculate&&calculate.textContent!==CALCULATE_COPY)calculate.textContent=CALCULATE_COPY;

  // The model performs a full authoritative rebuild before reaching this state.
  // Do not tell the user to sacrifice another cubie manually or imply that the
  // fixed reference should move.
  const status=root.querySelector("[data-tweak-status]");
  if(status&&/current solved-state assumptions still do not determine one legal cube/i.test(status.textContent||"")){
    status.textContent=CONFLICT_COPY;
  }
}

// v2 receives the solver result first so it can clear its busy state. We then
// close the editor and append the calculated correction path to the existing
// main-page move timeline. The previous "Solved" state becomes the checkpoint
// between the original solve and the newly appended tweak moves.
window.addEventListener("picture-tweak-solution",event=>{
  const installed=window.pictureSolutionControls?.appendTweakRoute?.(event.detail);
  if(!installed)return;
  const root=document.querySelector(".solution-tweak-modal");
  if(root)root.hidden=true;
  const hint=document.querySelector("[data-solved-tweak-hint]");
  if(hint){
    const count=Array.isArray(event.detail?.moves)?event.detail.moves.length:0;
    hint.textContent=count
      ?`${count} tweak move${count===1?"":"s"} added after the previous solved checkpoint. Continue with the main 3D controls.`
      :"The corrected state already matches the fixed reference.";
    hint.dataset.active="false";
  }
});

const observer=new MutationObserver(polishSolvedTweakUi);
// childList is sufficient for modal creation and textContent changes. Avoid
// characterData observation so ordinary live status text cannot cause needless
// repeated callbacks while the user is interacting with the modal.
observer.observe(document.documentElement,{childList:true,subtree:true});
polishSolvedTweakUi();
