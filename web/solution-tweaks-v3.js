import "./solution-tweaks-v2.js";

const CONFLICT_COPY=
  "Your current correction remains authoritative. All non-authoritative solved-state assumptions have been released automatically. The fixed reference has not been changed. If a conflict remains, it is between observations already marked authoritative, not with this correction.";

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

  // The model performs a full authoritative rebuild before reaching this state.
  // Do not tell the user to sacrifice another cubie manually or imply that the
  // fixed reference should move.
  const status=root.querySelector("[data-tweak-status]");
  if(status&&/current solved-state assumptions still do not determine one legal cube/i.test(status.textContent||"")){
    status.textContent=CONFLICT_COPY;
  }
}

const observer=new MutationObserver(polishSolvedTweakUi);
observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
polishSolvedTweakUi();
