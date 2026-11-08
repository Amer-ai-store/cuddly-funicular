const API_ROOT = '/api/v1';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// The server is the only source of persisted workspace state.
export async function createApiStore({ fetchImpl = globalThis.fetch.bind(globalThis), pollMs = 3000 } = {}) {
  let state = null;
  let revision = null;
  let etag = null;
  let disposed = false;
  let reading = false;
  const pendingScopes=new Set();
  let connection = { status: 'connecting', storage: 'D1', lastSyncAt: null, error: null, busy: false };
  const listeners = new Set();
  const clone = value => structuredClone(value);
  const notify = changes => listeners.forEach(listener => listener(changes));
  function setConnection(patch) {
    const next = { ...connection, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(connection)) {
      connection = next;
      notify({ stateChanged: false, connectionChanged: true });
    }
  }
  async function request(path, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(API_ROOT + path, {
        ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
      });
      if (response.status === 304) return { response, body: null };
      let body;
      try { body = await response.json(); }
      catch { throw new ApiError('لم يُرجع الخادم استجابة API صالحة. تحقق من تشغيل خدمة اللوحة.', { status: response.status, code: 'INVALID_RESPONSE' }); }
      if (!response.ok) {
        const error = new ApiError(body?.error?.message || 'تعذّر إتمام الطلب على الخادم.', { status: response.status, code: body?.error?.code || 'API_ERROR' });
        error.data = body;
        throw error;
      }
      return { response, body };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم. أعد المحاولة.' : 'تعذّر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.');
    } finally { clearTimeout(timeout); }
  }
  function adopt(body, response) {
    if (!body?.state || !Number.isSafeInteger(body.revision) || !Array.isArray(body.state.tasks) || !Array.isArray(body.state.workspaces)) {
      throw new ApiError('بيانات الخادم غير متوافقة مع لوحة القيادة.', { code: 'INVALID_RESPONSE' });
    }
    if(revision!==null&&body.revision<revision)return;
    const changed = state === null || revision !== body.revision;
    state = clone(body.state);
    revision = body.revision;
    etag = response?.headers?.get('ETag') || `"${revision}"`;
    connection = { ...connection, status: 'online', lastSyncAt: body.connection?.lastSyncAt || new Date().toISOString(), error: null };
    notify({ stateChanged: changed, connectionChanged: true });
  }
  function recordFailure(error) {
    if (!error.status || error.status === 401 || ['database_failure','database_unavailable','authentication_required','cross_site_request','INVALID_RESPONSE'].includes(error.code)) {
      setConnection({ status: 'offline', error: error.message });
    }
  }
  async function refresh({ force = false } = {}) {
    if (disposed || reading || connection.busy) return;
    reading = true;
    if (!state) setConnection({ status: 'connecting', error: null });
    try {
      const { body, response } = await request('/state', { headers: !force && etag ? { 'If-None-Match': etag } : {} });
      if (response.status === 304) setConnection({ status: 'online', lastSyncAt: new Date().toISOString(), error: null });
      else adopt(body, response);
    } catch (error) { recordFailure(error); throw error; }
    finally { reading = false; }
  }
  async function write(path, payload, { adoptState = true, timeoutMs = 15000, scope = null } = {}) {
    if (scope?pendingScopes.has(scope):connection.busy) throw new ApiError('يوجد طلب جارٍ في المسار نفسه. انتظر اكتماله قبل إرسال تغيير آخر.', { code: 'BUSY' });
    if (connection.status !== 'online') throw new ApiError('الاتصال بالخادم متوقف. أعد الاتصال قبل حفظ التغيير.', { code: 'OFFLINE' });
    if(scope){pendingScopes.add(scope);setConnection({pendingOperations:[...pendingScopes]});}else setConnection({ busy: true });
    try {
      const { body, response } = await request(path, { method: 'POST', body: JSON.stringify(payload) }, timeoutMs);
      if (adoptState) adopt(body, response);
      return body;
    } catch (error) {
      if (error.status === 409) {
        if (error.data?.state && Number.isSafeInteger(error.data.revision)) adopt(error.data);
        else {
          // Refresh only. Never replay a mutation after a revision conflict.
          const fresh = await request('/state').catch(() => null);
          if (fresh) adopt(fresh.body, fresh.response);
        }
        error.message = 'تغيّرت البيانات من جلسة أخرى. تم تحديث اللوحة؛ راجع التغيير ثم احفظه مجددًا.';
      }
      recordFailure(error);
      throw error;
    } finally { if(scope){pendingScopes.delete(scope);setConnection({pendingOperations:[...pendingScopes]});}else setConnection({ busy: false }); }
  }
  const controlRead=async path=>(await request(path)).body;
  const controlWrite=async(path,input,timeoutMs=15000)=>(await request(path,{method:'POST',body:JSON.stringify(input)},timeoutMs)).body;
  const mutate = (operation, payload = {}) => write('/actions', { operation, payload, expectedRevision: revision });
  const store = {
    getState: () => clone(state),
    getRevision: () => revision,
    getConnection: () => clone(connection),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    addTask: input => mutate('addTask', input),
    updateTask: (id, patch) => mutate('updateTask', { id, patch }),
    deleteTask: id => mutate('deleteTask', { id }),
    addWorkspace: input => mutate('addWorkspace', input),
    updateWorkspace: (id, patch) => mutate('updateWorkspace', { id, patch }),
    deleteWorkspace: id => mutate('deleteWorkspace', { id }),
    resolveApproval: (id, decision) => mutate('resolveApproval', { id, decision }),
    addNote: (workspaceId, body) => mutate('addNote', { workspaceId, body }),
    updateSettings: patch => mutate('updateSettings', patch),
    updateAgent: (id, patch) => mutate('updateAgent', { id, patch }),
    addServer: input => mutate('addServer', input),
    updateServer: (id, patch) => mutate('updateServer', { id, patch }),
    deleteServer: id => mutate('deleteServer', { id }),
    checkServer: id => write(`/servers/${encodeURIComponent(id)}/check`, { expectedRevision: revision }),
    getExecutionCapabilities: async () => (await request('/execution/capabilities')).body,
    startWorkflow: input => mutate('startWorkflow', input),
    addWorkflowStep: input => mutate('addWorkflowStep', input),
    recordWorkflowAnalysis: input => mutate('recordWorkflowAnalysis', input),
    recordWorkflowChange: input => mutate('recordWorkflowChange', input),
    recordWorkflowVerification: input => mutate('recordWorkflowVerification', input),
    advanceWorkflow: input => mutate('advanceWorkflow', input),
    analyzeWorkflow: id => write(`/workflows/${encodeURIComponent(id)}/analyze`, { expectedRevision: revision }, { timeoutMs: 35000, scope:'analysis:'+id }),
    getCoordination: () => controlRead('/coordination'),
    getAssistantCapabilities: () => controlRead('/assistant/capabilities'),
    getProviderHealth: () => controlRead('/assistant/provider/health'),
    testAssistantProvider: async () => {try{return await controlWrite('/assistant/provider/test',{},30000);}catch(error){if(error.data?.providerHealth)return {...error.data,httpStatus:error.status};throw error;}},
    getAssistantHistory: () => controlRead('/assistant/history'),
    configureAssistantProvider: input => controlWrite('/assistant/provider',input,20000),
    discoverAssistantModels: input => controlWrite('/assistant/provider/models',input,20000),
    assistantTurn: async input => {try{return await controlWrite('/assistant/chat',{...input,requestId:crypto.randomUUID()},45000);}catch(error){if(error.status>=400&&error.data?.provider==='local-advisor')return {...error.data,httpStatus:error.status};throw error;}},
    applyAssistantProposal: input => write('/assistant/apply',{proposalId:input.proposalId,expectedRevision:revision}),
    getDatabase: () => controlRead('/database'),
    createDatabaseBridge: input => controlWrite('/database/bridges',input),
    queueDatabaseOperation: input => controlWrite('/database/operations',{...input,requestId:input.requestId||crypto.randomUUID()}),
    exportData: () => JSON.stringify(state, null, 2),
    validateImport: data => write('/import/validate', { data }, { adoptState: false }),
    importData: data => mutate('importData', { data }),
    reset: () => mutate('reset'),
    dispose() { disposed = true; clearInterval(timer); globalThis.document?.removeEventListener('visibilitychange', onVisible); }
  };
  await refresh({ force: true });
  const onVisible = () => { if (!document.hidden) refresh().catch(() => {}); };
  const timer = setInterval(() => { if (!globalThis.document?.hidden) refresh().catch(() => {}); }, pollMs);
  globalThis.document?.addEventListener('visibilitychange', onVisible);
  return store;
}
