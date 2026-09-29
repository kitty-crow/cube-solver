import { ReferenceAlignmentModal as HistoryReferenceAlignmentModal } from "./reference-aligner-v13.js";

function installV14Styles(){
  if(document.querySelector("#reference-aligner-v14-styles"))return;
  const style=document.createElement("style");
  style.id="reference-aligner-v14-styles";
  style.textContent=`
    .reference-aligner__head {
      display:grid !important;
      grid-template-columns:minmax(0,1fr) auto auto;
      gap:.5rem !important;
      align-items:center !important;
      padding:.42rem max(.7rem,env(safe-area-inset-right)) .42rem max(.7rem,env(safe-area-inset-left)) !important;
      min-height:2.7rem;
    }
    .reference-aligner__head h2 { min-width:0; font-size:.96rem !important; line-height:1.15; }
    .reference-aligner__head .reference-aligner__status { min-width:0; max-width:16rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; font-size:.66rem; }
    .reference-aligner__head [data-align-close] {
      width:2rem; min-width:2rem; height:2rem; padding:0 !important;
      display:grid; place-items:center; border-radius:999px; font-size:1.25rem; line-height:1;
    }

    .reference-aligner__primary-controls {
      display:grid !important;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:.42rem !important;
      width:100%;
    }
    .reference-aligner__primary-controls > .reference-aligner__spacer { display:none !important; }
    .reference-aligner__primary-controls > .pages-button {
      width:100%; min-width:0; max-width:none; justify-content:center; text-align:center;
    }

    .reference-aligner__lockbar {
      display:grid !important;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:.42rem !important;
      width:100%;
      align-items:stretch !important;
    }
    .reference-aligner__lockbar-label { grid-column:1 / -1; margin:0 0 .05rem !important; }
    .reference-aligner__lockbar > .pages-button {
      width:100%; min-width:0; max-width:none; justify-content:center; text-align:center;
      padding-inline:.42rem;
    }

    .reference-aligner__overlay-panel { display:grid; gap:.58rem; }
    .reference-aligner__overlay-panel .reference-aligner__range {
      grid-template-columns:auto minmax(7rem,1fr) 3.4rem;
      width:100%;
      gap:.55rem;
    }
    .reference-aligner__overlay-actions {
      display:grid !important;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:.42rem !important;
      margin-top:0 !important;
      width:100%;
    }
    .reference-aligner__overlay-actions > .pages-button {
      width:100%; min-width:0; max-width:none; justify-content:center; text-align:center;
      white-space:normal; line-height:1.15;
    }

    @media(max-width:620px){
      .reference-aligner__head { grid-template-columns:minmax(0,1fr) auto; }
      .reference-aligner__head .reference-aligner__status { grid-column:1 / -1; grid-row:2; max-width:none; text-align:left; }
      .reference-aligner__head [data-align-close] { grid-column:2; grid-row:1; }
      .reference-aligner__lockbar { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .reference-aligner__primary-controls > .pages-button,
      .reference-aligner__lockbar > .pages-button,
      .reference-aligner__overlay-actions > .pages-button { font-size:.76rem; padding-inline:.35rem; }
    }

    @media(max-width:390px){
      .reference-aligner__overlay-actions { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(style);
}

export class ReferenceAlignmentModal extends HistoryReferenceAlignmentModal{
  makeRoot(){
    const root=super.makeRoot();
    installV14Styles();

    const header=root.querySelector(".reference-aligner__head");
    const heading=header?.querySelector("h2");
    const status=header?.querySelector("[data-align-status]");
    const close=header?.querySelector("[data-align-close]");
    if(close){
      close.textContent="×";
      close.setAttribute("aria-label","Close wrapped artwork adjustment");
      close.title="Close";
    }
    if(header&&heading&&status&&close)header.replaceChildren(heading,status,close);

    const modeButton=root.querySelector('[data-align-mode="global"]');
    const primary=modeButton?.closest(".reference-aligner__toolbar");
    primary?.classList.add("reference-aligner__primary-controls");

    const lockbar=root.querySelector(".reference-aligner__lockbar");
    if(lockbar){
      const label=lockbar.querySelector(".reference-aligner__lockbar-label");
      if(label)label.textContent="Allowed adjustments";
    }

    const opacity=root.querySelector("[data-align-opacity]");
    const overlayPanel=opacity?.closest(".reference-aligner__panel");
    overlayPanel?.classList.add("reference-aligner__overlay-panel");
    const resetAll=root.querySelector("[data-align-reset-all]");
    const overlayActions=resetAll?.closest(".reference-aligner__toolbar");
    overlayActions?.classList.add("reference-aligner__overlay-actions");

    return root;
  }
}
