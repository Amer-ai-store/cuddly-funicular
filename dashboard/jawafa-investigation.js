/* Jawafa evidence index – read-only client view, no secrets or DB writes. */
(() => {
  "use strict";
  const root = document.getElementById("jf-investigation");
  if (!root) return;
  const get = id => document.getElementById(id);
  const set = (id, value) => { const node = get(id); if (node) node.textContent = String(value == null ? "—" : value); };
  const filters = [["all", "جميع التقارير"],["gl", "السندات"],["bank", "الشيكات والبنوك"],["returns", "المردودات والضريبة"]];
  const states = {verified_scope:"مطابقة ضمن النطاق",partial:"مكتمل جزئيًا",open:"التحقيق مفتوح"};
  let source = null, active = "all", downloading = false;
  function el(tag,value,className){
    const node = document.createElement(tag);
    if(value !== undefined && value !== null) node.textContent=String(value);
    if(className) node.className=className;
    return node;
  }
  // No privileged document links in a public view.
  function privateReference(label){return el("span",label+" — مرجع خاص (لا رابط عام)","jf-label");}
  function empty(target,message){target.replaceChildren(el("p",message,"jf-desc"));}
  function summary(items){
    const node=get("jf-summary");if(!node)return;node.replaceChildren();
    for(const x of items){
      const card=el("article",null,"jf-card");
      card.append(el("div",x.label||"مؤشر","jf-card-title"),el("strong",x.value||"—"),el("p",x.detail||""));
      node.append(card);
    }
  }
  function tracks(items){
    const node=get("jf-tracks");if(!node)return;node.replaceChildren();
    for(const x of items){
      const card=el("article");
      card.append(el("h4",x.label));
      const badge=el("span",states[x.state]||"قيد التحقيق","jf-pill");
      badge.dataset.status=x.state;
      card.append(badge,el("p",x.next||"","jf-desc"),el("div",(x.reports||[]).join(" · "),"jf-label"));
      node.append(card);
    }
  }
  function drawReports(){
    const node=get("jf-report-rows");if(!node||!source)return;node.replaceChildren();
    const rows=source.reports.filter(r=>active==="all"||r.category===active||r.category==="all");
    for(const x of rows){
      const tr=el("tr"), title=el("td"),info=el("td"),links=el("td");
      title.append(el("span",x.id,"jf-evid"),el("div",x.title));
      info.append(el("div",x.kind||""),el("small",x.note||"","jf-label"));
      links.append(privateReference("فتح التقرير يتطلب وصولًا خاصًا"));
      tr.append(title,info,el("td",x.date||"—"),el("td","مرجع خاص — الرابط غير منشور"),links);
      node.append(tr);
    }
    set("jf-results-count","المعروض: "+rows.length+" من "+source.reports.length+" تقريرًا مفهرسًا بلا روابط عامة");
  }
  function drawFilters(){
    const node=get("jf-report-filters");if(!node)return;node.replaceChildren();
    for(const [key,label] of filters){
      const b=el("button",label);b.type="button";b.dataset.filter=key;
      b.setAttribute("aria-pressed",String(key===active));
      b.addEventListener("click",()=>{
        active=key;
        for(const btn of node.querySelectorAll("button"))btn.setAttribute("aria-pressed",String(btn.dataset.filter===key));
        drawReports();
      });
      node.append(b);
    }
  }
  function evidence(items,pending){
    const node=get("jf-evidence");if(!node)return;node.replaceChildren();
    for(const x of items)node.append(privateReference(x.label));
    for(const x of pending)node.append(el("span",x.id+": غير مثبت على Drive","jf-label"));
  }
  async function reload(){
    if(downloading)return;downloading=true;
    set("jf-load","جاري قراءة فهرس الأدلة...");
    try{
      const response=await fetch("./data/jawafa-investigation-reports.json?v="+Date.now(),{
        cache:"no-store",credentials:"omit",headers:{Accept:"application/json"}
      });
      if(!response.ok)throw new Error("HTTP "+response.status);
      const data=await response.json();
      if(data.schema!=="jawafa-investigation-reports-v1"||
        data.classification!=="PUBLIC_STATUS_ONLY__PRIVATE_LINKS_REDACTED"||
        !Array.isArray(data.reports)||!Array.isArray(data.summary)||
        !Array.isArray(data.investigations)||!Array.isArray(data.private_evidence))
        throw new Error("مخطط فهرس التحقيق غير معتمد");
      if(data.reports.some(x=>x.href!==null)||data.private_evidence.some(x=>x.href!==null))throw new Error("ظهر رابط خاص داخل فهرس عام");
      source=data;
      summary(data.summary);tracks(data.investigations);drawFilters();drawReports();
      evidence(data.private_evidence,data.pending_artifacts||[]);
      set("jf-load","مرجع حتى "+data.data_cutoff+" · "+data.reports.length+" تقارير · قراءة فقط");
      set("jf-release",data.release_gate==="BLOCKED_ISSUE_102"?
        "النشر الإنتاجي محجوب (Issue #102) — مرحلة مراجعة فقط":"حالة النشر بحاجة تحقق مستقل");
      set("jf-source-note","المصدر: ملفات التحقيق على Drive الخاص، آخر حدود بيانات "+data.data_cutoff+
        "؛ ليست قراءة بنكية أو SQL مباشرة. لا خسائر أو اتهامات مثبتة.");
    }catch(error){
      set("jf-load","تعذر استيراد فهرس الأدلة: "+String(error.message||error).slice(0,95));
      // Fail closed on every failed refresh: old evidence must not look current.
      source=null;active="all";
      const a=get("jf-summary"),b=get("jf-tracks");
      if(a)empty(a,"المؤشرات غير متاحة؛ لن تُعرض أرقام افتراضية.");
      if(b)empty(b,"تعذر التحقق من الملفات؛ استخدم روابط التقارير الموجودة أعلاه.");
      for(const id of ["jf-report-rows","jf-report-filters","jf-evidence"]){
        const node=get(id);if(node)node.replaceChildren();
      }
      set("jf-results-count","المعروض: 0 — فهرس غير متاح");
      set("jf-release","النشر الإنتاجي غير معتمد — Issue #102");
      set("jf-source-note","تعذر التحقق من أحدث فهرس؛ لا تعرض هذه الشاشة نتائج قديمة كأنها حديثة.");
    }finally{downloading=false;}
  }
  const button=get("jf-reload");if(button)button.addEventListener("click",reload);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)reload();});
  reload();
})();
