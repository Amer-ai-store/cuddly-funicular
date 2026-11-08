import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBridgeRequest,boundedBridgeText,MAX_BRIDGE_BYTES} from '../dist/bridge-protocol.js';
const request=(patch={})=>({id:crypto.randomUUID(),path:'/api/v1/state',method:'GET',headers:[['accept','application/json']],body:null,...patch});
test('owner bridge restricts paths, credentials, methods and payload sizes before any fetch',()=>{
  assert.equal(validateBridgeRequest(request()).path,'/api/v1/state');
  assert.equal(validateBridgeRequest(request({path:'/api/v1/state?fresh=1',method:'POST',body:'{}'})).body,'{}');
  for(const patch of [{path:'https://other.example/api/v1/state'},{path:'//other.example/api/v1/state'},{path:'/api/v1/../../signin'},{path:'/api/v1/..\\signin'},{path:'/api/v1/state#other'},{method:'CONNECT'},{method:'OPTIONS'},{headers:[['authorization','Bearer injected']]},{headers:[['oai-authenticated-user-id','injected']]},{headers:[['x-aas-api-key','injected']]},{headers:[['cookie','injected']]},{headers:[['accept','text/plain\r\ninvalid: value']]},{body:'not permitted on GET'},{method:'POST',body:'x'.repeat(MAX_BRIDGE_BYTES+1)},{id:'not-an-id'}])assert.equal(validateBridgeRequest(request(patch)),null);
});
test('bridge keeps304 empty and rejects streamed or declared oversized responses',async()=>{
  assert.equal(await boundedBridgeText(new Response(null,{status:304})), '');
  assert.equal(await boundedBridgeText(new Response('نص API')), 'نص API');
  await assert.rejects(boundedBridgeText(new Response('x',{headers:{'content-length':String(MAX_BRIDGE_BYTES+1)}})));
  await assert.rejects(boundedBridgeText(new Response('x'.repeat(MAX_BRIDGE_BYTES+1))));
});
