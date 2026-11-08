import { fetchRepositorySnapshot, fetchRepositoryAtomSnapshot } from './github.mjs';

export const REPOSITORY = 'Amer-ai-store/Mohammad-Ahmed-Ghannam';
const TTL_MS = 5 * 60_000;
const COOLDOWN_MS = 60_000;

/** Persistent observations are independent of the organization's mutation revision. */
export async function getRepositoryStatus(env, {force = false, now = Date.now(), fetchImpl} = {}) {
  const db=env.DB;
  const key=REPOSITORY;
  await db.prepare('INSERT OR IGNORE INTO aas_repository_cache (id, document, checked_at, attempted_at, error) VALUES (?, NULL, 0, 0, NULL)').bind(key).run();
  const load=()=>db.prepare('SELECT document, checked_at, attempted_at, error FROM aas_repository_cache WHERE id = ?').bind(key).first();
  let row=await load();
  const snapshot=()=>row.document?JSON.parse(row.document):null;
  const savedError=()=>row.error?JSON.parse(row.error):null;
  function response(cached,error=savedError()) {
    const repository=snapshot();
    if(!repository&&!error)error={code:'github_refresh_in_progress',message:'يجري جلب بيانات المستودع. أعد المحاولة بعد لحظات.'};
    // REST backoff does not block the separate, unauthenticated public feed.
    const retry=error?.code!=='github_rate_limited'&&error?.retryAt ? Date.parse(error.retryAt) : 0;
    const nextRefreshAt=new Date(Math.max(row.attempted_at+COOLDOWN_MS,Number.isFinite(retry)?retry:0)).toISOString();
    const value={repository,cached,stale:Boolean(error)||(repository?now-row.checked_at>TTL_MS:false),nextRefreshAt};
    if(error)value.error=error;
    return {status:repository?200:503,body:value};
  }
  const priorError=savedError();
  const retryAt=priorError?.code==='github_rate_limited'?priorError.retryAt:snapshot()?.restRetryAt;
  const restBlocked=Boolean(retryAt&&Date.parse(retryAt)>now);
  if((!force&&row.document&&now-row.checked_at<TTL_MS) || now-row.attempted_at<COOLDOWN_MS) return response(true);
  const lease=await db.prepare('UPDATE aas_repository_cache SET attempted_at = ? WHERE id = ? AND attempted_at <= ?').bind(now,key,now-COOLDOWN_MS).run();
  if(lease.meta.changes!==1){
    row=await load();
    return response(true,savedError()||(!row.document?{code:'github_refresh_in_progress',message:'يجري جلب بيانات المستودع. أعد المحاولة بعد لحظات.'}:null));
  }
  let rateError=restBlocked?{code:'github_rate_limited',message:'GitHub API محدود مؤقتًا؛ يجري استخدام سجل الالتزامات العام.',retryAt}:null;
  try{
    const options={repoFullName:REPOSITORY,now};
    if(env.GITHUB_TOKEN)options.token=env.GITHUB_TOKEN;
    if(fetchImpl)options.fetchImpl=fetchImpl;
    else if(env.GITHUB_API_HTTP)options.fetchImpl=(url,init)=>env.GITHUB_API_HTTP.fetch(new Request(url,init));
    let repository;
    if(restBlocked)repository=await fetchRepositoryAtomSnapshot({...options,restRetryAt:retryAt});
    else {
      try { repository=await fetchRepositorySnapshot(options); }
      catch(error) {
        if(error.code!=='github_rate_limited')throw error;
        rateError=error;
        repository=await fetchRepositoryAtomSnapshot({...options,restRetryAt:error.retryAt});
      }
    }
    const checkedAt=Date.parse(repository.checkedAt);
    await db.prepare('UPDATE aas_repository_cache SET document = ?, checked_at = ?, error = NULL WHERE id = ?').bind(JSON.stringify(repository),checkedAt,key).run();
    row=await load();
    return response(false,null);
  }catch(error){
    const observed=rateError||error;
    const safeError={code:observed.code||'github_unavailable',message:rateError?'تعذر قراءة سجل الالتزامات العام، وGitHub API ما زال محدودًا مؤقتًا. أعد المحاولة لاحقًا.':error.code?error.message:'تعذّر جلب بيانات GitHub الآن. أعد المحاولة لاحقًا.'};
    if(observed.retryAt)safeError.retryAt=observed.retryAt;
    if(rateError)safeError.fallbackUnavailable=true;
    await db.prepare('UPDATE aas_repository_cache SET error = ? WHERE id = ?').bind(JSON.stringify(safeError),key).run();
    row=await load();
    return response(true,safeError);
  }
}
