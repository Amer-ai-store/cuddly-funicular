/* Source: Amer-ai-store/Amer-AI-Store-/app/src/main/java/com/example/data/agent/AgentModels.kt
 * Public organizational definitions only. No model runtime, token, credentials or user data.
 */
export const OFFICIAL_AGENTS = Object.freeze([
  {
    "id": "general-manager",
    "name": "المدير العام",
    "role": "الإدارة والرقابة",
    "initials": "GM",
    "color": "#5279dc",
    "status": "ready",
    "model": "غير متصل",
    "description": "بدء وإغلاق العمليات الرئيسية، اعتماد/رفض المخرجات، وإدارة بوابات الإغلاق.",
    "group": "MANAGEMENT"
  },
  {
    "id": "agents-supervisor",
    "name": "مراقب الوكلاء",
    "role": "الإدارة والرقابة",
    "initials": "AS",
    "color": "#5279dc",
    "status": "ready",
    "model": "غير متصل",
    "description": "متابعة التزام الوكلاء، حالات المهام، Handoff، سجل الأخطاء المركزي، وإثباتات الأدلة.",
    "group": "MANAGEMENT"
  },
  {
    "id": "ideas-agent",
    "name": "وكيل الأفكار والفرص",
    "role": "المنتج والتطوير",
    "initials": "IA",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "اكتشاف الفرص، صياغة المقترحات الابتكارية، وتحليل احتياجات السوق والمستخدم.",
    "group": "PRODUCT"
  },
  {
    "id": "development-manager",
    "name": "مدير التطوير الهندسي",
    "role": "المنتج والتطوير",
    "initials": "DM",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "تحويل الأفكار إلى متطلبات تقنية وهندسية وخطة تنفيذية دقيقة.",
    "group": "PRODUCT"
  },
  {
    "id": "ux-customer-journey",
    "name": "وكيل تجربة المستخدم والرحلة",
    "role": "المنتج والتطوير",
    "initials": "UCJ",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "تصميم رحلة المستخدم، إزالة نقاط الاحتكاك، وتحسين سهولة الاستخدام وسرعة الإنجاز.",
    "group": "PRODUCT"
  },
  {
    "id": "design-presentation-agent",
    "name": "وكيل التصميم والعرض البصري",
    "role": "المنتج والتطوير",
    "initials": "DPA",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "تطوير منظومة التصميم Living Store، الشاشات، Command Orb، والمكونات البصرية.",
    "group": "PRODUCT"
  },
  {
    "id": "execution-agent",
    "name": "وكيل التنفيذ البرمجي",
    "role": "المنتج والتطوير",
    "initials": "EA",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "البرمجة والتنفيذ الفعلي، بناء الميزات الحقيقية، وإجراء الاختبارات والتكاملات.",
    "group": "PRODUCT"
  },
  {
    "id": "qa-agent",
    "name": "وكيل فحص وضمان الجودة",
    "role": "المنتج والتطوير",
    "initials": "QA",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "الاختبارات المستقلة والتحقق الصارم من معايير القبول وعدم السماح بالأخطاء الصامتة.",
    "group": "PRODUCT"
  },
  {
    "id": "preview-agent",
    "name": "وكيل المعاينة التفاعلية",
    "role": "المنتج والتطوير",
    "initials": "PA",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "تشغيل وتجهيز أحدث Build فعلي لإنتاج بيئة Preview حقيقية قابلة للفحص.",
    "group": "PRODUCT"
  },
  {
    "id": "evaluation-agent",
    "name": "وكيل التقييم والاعتماد النهائي",
    "role": "المنتج والتطوير",
    "initials": "EA",
    "color": "#8a6bcc",
    "status": "ready",
    "model": "غير متصل",
    "description": "تقييم النسخة المرئية الفعلية بعد المعاينة، وعدم إصدار نسب نجاح دون فحص مرئي.",
    "group": "PRODUCT"
  },
  {
    "id": "field-agent",
    "name": "وكيل الميدان واستطلاع السوق",
    "role": "النمو والعملاء",
    "initials": "FA",
    "color": "#28896c",
    "status": "ready",
    "model": "غير متصل",
    "description": "رصد احتياجات التجار والمستهلكين الميدانية، والأسعار الواقعية بالمتاجر.",
    "group": "GROWTH"
  },
  {
    "id": "marketing-agent",
    "name": "وكيل التسويق والحملات",
    "role": "النمو والعملاء",
    "initials": "MA",
    "color": "#28896c",
    "status": "ready",
    "model": "غير متصل",
    "description": "إعداد الحملات الترويجية، استوديو المحتوى، صياغة الإعلانات ثنائية اللغة AR/EN.",
    "group": "GROWTH"
  },
  {
    "id": "data-growth-intelligence",
    "name": "وكيل بيانات ونمو السوق",
    "role": "النمو والعملاء",
    "initials": "DGI",
    "color": "#28896c",
    "status": "ready",
    "model": "غير متصل",
    "description": "تحليل سلوك الشراء، تحسين تحويل السلة، والتنبؤ بالطلب والأسعار التنافسية.",
    "group": "GROWTH"
  },
  {
    "id": "marketplace-merchant-success",
    "name": "وكيل السوق ونجاح التجار",
    "role": "السوق والعمليات",
    "initials": "MMS",
    "color": "#cc8141",
    "status": "ready",
    "model": "غير متصل",
    "description": "إدارة كتالوج المنتجات، فحص حالة المخزون، وتأهيل التجار المسجلين والافتراضيين.",
    "group": "MARKETPLACE"
  },
  {
    "id": "delivery-agent",
    "name": "وكيل التوصيل واللوجستيات",
    "role": "السوق والعمليات",
    "initials": "DA",
    "color": "#cc8141",
    "status": "ready",
    "model": "غير متصل",
    "description": "تنسيق مسارات التوصيل، حساب أوقات الوصول ETA، ومتابعة Order Digital Twin.",
    "group": "MARKETPLACE"
  },
  {
    "id": "trust-customer-support",
    "name": "وكيل الثقة ودعم العملاء",
    "role": "النمو والعملاء",
    "initials": "TCS",
    "color": "#28896c",
    "status": "ready",
    "model": "غير متصل",
    "description": "معالجة النزاعات، تحليل الفواتير الذكي، وضمان حقوق المشتري واسترداد الأموال.",
    "group": "GROWTH"
  },
  {
    "id": "security-fraud",
    "name": "وكيل الأمن ومكافحة الاحتيال",
    "role": "الحوكمة والمالية",
    "initials": "SF",
    "color": "#a55f83",
    "status": "ready",
    "model": "غير متصل",
    "description": "فحص أمان المعاملات، كشف محاولات التلاعب بالأسعار أو الحسابات الوهمية.",
    "group": "GOVERNANCE"
  },
  {
    "id": "finance-unit-economics",
    "name": "وكيل المالية واقتصاديات الوحدة",
    "role": "الحوكمة والمالية",
    "initials": "FUE",
    "color": "#a55f83",
    "status": "ready",
    "model": "غير متصل",
    "description": "مراقبة هوامش الربح، تكاليف التوصيل، موازنة سلة الشراء الذكية، والمدفوعات.",
    "group": "GOVERNANCE"
  },
  {
    "id": "legal-compliance",
    "name": "وكيل القانون والامتثال",
    "role": "الحوكمة والمالية",
    "initials": "LC",
    "color": "#a55f83",
    "status": "ready",
    "model": "غير متصل",
    "description": "التحقق من سياسات الخصوصية، شروط التجارة الإلكترونية، وتوافق حماية المستهلك.",
    "group": "GOVERNANCE"
  }
]);
const GROUPS = Object.freeze({
  "MANAGEMENT": {
    "id": "ws-official-management",
    "name": "الإدارة والرقابة · الوكلاء الرسميون",
    "color": "#5279dc"
  },
  "PRODUCT": {
    "id": "ws-official-product",
    "name": "المنتج والتطوير · الوكلاء الرسميون",
    "color": "#8a6bcc"
  },
  "GROWTH": {
    "id": "ws-official-growth",
    "name": "النمو والعملاء · الوكلاء الرسميون",
    "color": "#28896c"
  },
  "MARKETPLACE": {
    "id": "ws-official-marketplace",
    "name": "السوق والعمليات · الوكلاء الرسميون",
    "color": "#cc8141"
  },
  "GOVERNANCE": {
    "id": "ws-official-governance",
    "name": "الحوكمة والمالية · الوكلاء الرسميون",
    "color": "#a55f83"
  }
});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function prepareOfficialRoster(input){
  if(!input||input.schemaVersion!==2||input.demoMode!==false||!Array.isArray(input.agents)||!Array.isArray(input.workspaces)||!Array.isArray(input.tasks)||!Array.isArray(input.approvals)||!Array.isArray(input.servers))throw Error('مصدر AAS الخاص غير متوافق؛ أُلغي الاستيراد دون تعديل.');
  // importData resets server checks. Never trigger that side effect when any check is recorded.
  if(input.servers.some(s=>s.status!=='unverified'||s.lastCheckedAt!=null||s.lastHttpStatus!=null||s.latencyMs!=null||s.lastError!=null))throw Error('توجد فحوص خوادم محفوظة؛ الاستيراد العام سيصفر حالتها. أوقفنا النقل لحمايتها؛ يلزم ترحيل خادمي متخصص.');
  const candidate=structuredClone(input),agentsById=new Map(candidate.agents.map(a=>[a.id,a])),spacesById=new Map(candidate.workspaces.map(w=>[w.id,w]));
  let added=0,assigned=0,createdWorkspaces=0;
  for(const source of OFFICIAL_AGENTS){
    let found=agentsById.get(source.id);
    if(found&&found.name!==source.name)throw Error('تعارض معرّف وكيل موجود ('+source.id+'). أُلغي الاستيراد حفاظًا على السجل الأصلي.');
    if(!found){const {group,...agent}=source;candidate.agents.push(agent);agentsById.set(agent.id,agent);added++;}
    const definition=GROUPS[source.group];let ws=spacesById.get(definition.id);
    if(!ws){ws={id:definition.id,name:definition.name,description:'المساحة التنظيمية لتعريفات Amer AI Store الرسمية. التشغيل الآلي غير مثبت.',agentIds:[],status:'active',color:definition.color,notes:[]};candidate.workspaces.push(ws);spacesById.set(ws.id,ws);createdWorkspaces++;}
    if(!Array.isArray(ws.agentIds))throw Error('عضوية المساحة '+ws.id+' غير صالحة؛ أُلغي الاستيراد.');
    if(!ws.agentIds.includes(source.id)){ws.agentIds.push(source.id);assigned++;}
  }
  if(candidate.agents.length>120||candidate.workspaces.length>510)throw Error('تجاوز الاستيراد حدود سجلات الخادم.');
  for(const key of ['tasks','approvals','activity','servers','runs','workflows','commerce','settings'])if(!equal(candidate[key],input[key]))throw Error('تغيّر سجل محمي ('+key+'). أُلغي الاستيراد.');
  const ids=new Set(candidate.agents.map(a=>a.id));if(ids.size!==candidate.agents.length)throw Error('تكررت معرّفات الوكلاء.');
  return {candidate,summary:{added,assigned,createdWorkspaces,total:OFFICIAL_AGENTS.length,alreadyRegistered:OFFICIAL_AGENTS.length-added,changed:added>0||assigned>0||createdWorkspaces>0}};
}
