/* Private-on-device registry: project URLs and many-to-many conversation routing.
 * Registering a ChatGPT URL grants NO access, automation, or message delivery.
 * It never crawls a project or uploads these URLs to a public GitHub issue.
 */
export const LINKS_STORAGE_KEY="amer.projectMessageHub.links.v2";
export const MAX_NODES=100,MAX_RELATIONS=500;
export const EMPTY_GRAPH={schema:2,nodes:[],edges:[],projects:{},auto_pairs:[],excluded_edges:[]};
function safeChatGPTUrl(value){
  if(typeof value!=="string")throw Error("INVALID_URL");
  let url;
  try{url=new URL(value.trim());}catch{throw Error("INVALID_URL");}
  if(url.protocol!=="https:"||url.hostname!=="chatgpt.com"||url.username||url.password||url.port)throw Error("CHATGPT_LINK_ONLY");
  return url.pathname.replace(/\/+$/,"");
}
export function normalizeChatUrl(value){
  const path=safeChatGPTUrl(value);
  if(!/^\/(?:(?:g|g-p)\/[A-Za-z0-9_-]+\/)?(?:c|share)\/[A-Za-z0-9-]+$/.test(path))throw Error("CHAT_LINK_REQUIRED");
  return "https://chatgpt.com"+path;
}
export function normalizeProjectUrl(value){
  const path=safeChatGPTUrl(value);
  if(!(/^\/g\/g-p-[A-Za-z0-9_-]+(?:\/project)?$/.test(path)||/^\/projects?\/[A-Za-z0-9_-]+$/.test(path)))throw Error("PROJECT_LINK_REQUIRED");
  return "https://chatgpt.com"+path;
}
const PROJECTS=["gpt","التقرير النهائي"];
export function parseSideLinks(text,project){
  if(!PROJECTS.includes(project))throw Error("UNKNOWN_PROJECT");
  const lines=String(text||"").split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  if(lines.length>MAX_NODES)throw Error("INVALID_LINK_COUNT");
  const entries=lines.map((raw,i)=>{
    const pivot=raw.indexOf("|");
    const title=pivot===-1?"محادثة "+(i+1):raw.slice(0,pivot).trim().slice(0,80);
    const link=pivot===-1?raw:raw.slice(pivot+1).trim();
    const url=normalizeChatUrl(link);
    return {key:project+"::"+url,project,url,title:title||"محادثة "+(i+1)};
  });
  return [...new Map(entries.map(e=>[e.key,e])).values()];
}
function cleanGraph(initial){
  const i=initial||{};
  return {schema:2,nodes:Array.isArray(i.nodes)?i.nodes.slice():[],edges:Array.isArray(i.edges)?i.edges.slice():[],projects:i.projects&&typeof i.projects==="object"?{...i.projects}:{},auto_pairs:Array.isArray(i.auto_pairs)?i.auto_pairs.slice():[],excluded_edges:Array.isArray(i.excluded_edges)?i.excluded_edges.slice():[]};
}
function edgeKey(a,b){return JSON.stringify([a,b].sort());}
function addNodes(graph,list){
  const keys=new Set(graph.nodes.map(n=>n.key));
  for(const node of list){
    const index=graph.nodes.findIndex(n=>n.key===node.key);
    if(index>=0)graph.nodes[index]=node;
    else{graph.nodes.push(node);keys.add(node.key);}
  }
  if(graph.nodes.length>MAX_NODES)throw Error("TOO_MANY_CHATS");
}
export function registerChats(initial,project,raw){
  const graph=cleanGraph(initial);
  addNodes(graph,parseSideLinks(raw,project));
  if(effectiveEdges(graph).length>MAX_RELATIONS)throw Error("TOO_MANY_RELATIONS");
  return graph;
}
export function connectProjects(initial,{first_project="gpt",first_url,second_project="التقرير النهائي",second_url,auto_link=true}){
  if(!PROJECTS.includes(first_project)||!PROJECTS.includes(second_project)||first_project===second_project)throw Error("DISTINCT_PROJECTS_REQUIRED");
  const graph=cleanGraph(initial);
  graph.projects[first_project]=normalizeProjectUrl(first_url);
  graph.projects[second_project]=normalizeProjectUrl(second_url);
  const id=edgeKey(first_project,second_project);
  graph.auto_pairs=graph.auto_pairs.filter(pair=>pair.id!==id);
  if(auto_link)graph.auto_pairs.push({id,left:first_project,right:second_project});
  if(effectiveEdges(graph).length>MAX_RELATIONS)throw Error("TOO_MANY_RELATIONS");
  return graph;
}
export function createLinkGraph(initial,left,right){
  if(left.length&&right.length&&left[0].project===right[0].project)throw Error("DISTINCT_PROJECTS_REQUIRED");
  const graph=cleanGraph(initial);addNodes(graph,[...left,...right]);
  for(const a of left)for(const b of right){
    if(a.key===b.key)continue;
    const id=edgeKey(a.key,b.key);
    if(!graph.edges.some(e=>e.id===id))graph.edges.push({id,left:a.key,right:b.key,connected:false});
    graph.excluded_edges=graph.excluded_edges.filter(x=>x!==id);
  }
  if(effectiveEdges(graph).length>MAX_RELATIONS)throw Error("TOO_MANY_RELATIONS");
  return graph;
}
export function effectiveEdges(graph){
  const map=new Map();
  const nodes=graph?.nodes||[];
  const exclusions=new Set(graph?.excluded_edges||[]);
  for(const e of graph?.edges||[])if(!exclusions.has(e.id))map.set(e.id,{...e,connected:false});
  for(const pair of graph?.auto_pairs||[]){
    for(const a of nodes.filter(n=>n.project===pair.left))for(const b of nodes.filter(n=>n.project===pair.right)){
      const id=edgeKey(a.key,b.key);
      if(!exclusions.has(id)&&!map.has(id))map.set(id,{id,left:a.key,right:b.key,connected:false,automatic:true});
    }
  }
  return [...map.values()];
}
export function neighbors(graph,nodeKey){
  const ids=effectiveEdges(graph).filter(e=>e.left===nodeKey||e.right===nodeKey).map(e=>e.left===nodeKey?e.right:e.left);
  return (graph?.nodes||[]).filter(n=>ids.includes(n.key));
}
export function unlink(graph,relationId){
  const g=cleanGraph(graph);
  g.edges=g.edges.filter(e=>e.id!==relationId);
  if(!g.excluded_edges.includes(relationId))g.excluded_edges.push(relationId);
  return g;
}
export function loadLinkGraph(store){
  try{
    const raw=store.getItem(LINKS_STORAGE_KEY)||store.getItem("amer.projectMessageHub.links.v1");
    const data=JSON.parse(raw||"null");
    if(!data||![1,2].includes(data.schema))return cleanGraph(EMPTY_GRAPH);
    const graph=cleanGraph(data);
    graph.nodes=graph.nodes.filter(n=>PROJECTS.includes(n.project)&&typeof n.key==="string"&&typeof n.url==="string"&&typeof n.title==="string"&&n.key===n.project+"::"+normalizeChatUrl(n.url));
    const keys=new Set(graph.nodes.map(n=>n.key));
    graph.edges=graph.edges.filter(e=>keys.has(e.left)&&keys.has(e.right)&&e.id===edgeKey(e.left,e.right));
    graph.auto_pairs=graph.auto_pairs.filter(e=>PROJECTS.includes(e.left)&&PROJECTS.includes(e.right)&&e.left!==e.right);
    graph.projects=Object.fromEntries(Object.entries(graph.projects).filter(([name,url])=>PROJECTS.includes(name)&&typeof url==="string").map(([name,url])=>[name,normalizeProjectUrl(url)]));
    if(graph.nodes.length>MAX_NODES||effectiveEdges(graph).length>MAX_RELATIONS)return cleanGraph(EMPTY_GRAPH);
    return graph;
  }catch{return cleanGraph(EMPTY_GRAPH);}
}
export function saveLinkGraph(store,graph){store.setItem(LINKS_STORAGE_KEY,JSON.stringify(graph));}
