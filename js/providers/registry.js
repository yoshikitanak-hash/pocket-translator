import * as gemini from './gemini.js';

class ProviderError extends Error {
  constructor(kind,message){super(message);this.kind=kind;}
}
function failure(status){
 if(status===401)return new ProviderError('auth','认证失败，请检查当前供应商的 API Key');
 if(status===403)return new ProviderError('permission','无权访问此模型，或所在地区不支持');
 if(status===402)return new ProviderError('quota','供应商余额不足');
 if(status===429)return new ProviderError('rate','供应商配额不足或请求被限流，请稍后重试');
 if(status===404)return new ProviderError('model','模型或接口不存在，请核对模型 ID');
 return new ProviderError('other',`供应商请求失败（${status}），请检查模型权限及参数`);
}
async function request(url,options){
 let r;
 try{r=await fetch(url,options);}catch(e){if(e.name==='AbortError')throw e;
  if (/^https:\/\/(api\.z\.ai|open\.bigmodel\.cn)\//.test(url)) throw new ProviderError('network','智谱 / Z.ai 网页连接失败：已使用兼容跨域预检的接口路径，请检查网络或稍后重试。模型列表可用不等于翻译已通过；不会自动更换供应商。');
  throw new ProviderError('network','无法直连供应商：可能是网络、地区或浏览器跨域限制。不会自动改走中转。');}
 if(!r.ok)throw failure(r.status);
 return r;
}
export async function* events(response){
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
 try{
  while(true){
   const {value,done}=await reader.read();buffer+=done?decoder.decode()+'\n':decoder.decode(value,{stream:true});
   let n;
   while((n=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,n).trim();buffer=buffer.slice(n+1);
    if(!line.startsWith('data:'))continue;
    const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;
    let event;try{event=JSON.parse(data);}catch{throw new ProviderError('stream','供应商返回了无法解析的流式数据');}
    yield event;
   }
   if(done)break;
  }
 }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
function adapter(id,label,base,type){
 const headers=key=>type==='anthropic'?{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}:{'Content-Type':'application/json',Authorization:`Bearer ${key}`};
 return {id,label,base,
  async listModels(key){
   const r=await request(base+'/models',{headers:headers(key)}),j=await r.json();
   return (j.data||[]).filter(m=>!m.architecture?.output_modalities||m.architecture.output_modalities.includes('text')).map(m=>m.id).filter(n=>n&&!/embedding|whisper|tts|dall-e|image|transcri|realtime|moderation|audio/i.test(n)).sort();
  },
  pickDefault(models,current){return models.includes(current)?current:'';},
  async *stream({key,model,system,messages,signal}){
   const turns=messages.map(m=>({role:m.role==='model'?'assistant':'user',content:m.text}));
   let body,path;
   if(type==='responses'){path='/responses';body={model,instructions:system,input:turns,stream:true,store:false};}
   else if(type==='anthropic'){path='/messages';body={model,system,messages:turns,max_tokens:8192,stream:true};}
   else{path='/chat/completions';body={model,messages:[{role:'system',content:system},...turns],stream:true};}
   // These gateways expose CORS preflight on the trailing-slash route.
   if (id === 'zai' || id === 'zhipu') path += '/';
   const r=await request(base+path,{method:'POST',headers:headers(key),body:JSON.stringify(body),signal});
   let got=false,complete=false;
   try{
    for await(const e of events(r)){
     if(e.error||e.type==='error'||e.type==='response.failed')throw new ProviderError('stream','供应商生成失败，已保留收到的部分，请重试');
     let text='';
     if(type==='responses'){
      if(e.type==='response.output_text.delta')text=e.delta||'';
      if(e.type==='response.completed')complete=true;
      if(e.type==='response.incomplete')throw new ProviderError('incomplete','生成被截断，请重试或缩短原文');
     }else if(type==='anthropic'){
      if(e.type==='content_block_delta'&&e.delta?.type==='text_delta')text=e.delta.text||'';
      if(e.type==='message_delta'&&e.delta?.stop_reason&& !['end_turn','stop_sequence'].includes(e.delta.stop_reason))throw new ProviderError('incomplete','生成未完整结束，请重试或缩短原文');
      if(e.type==='message_stop')complete=true;
     }else{
      text=e.choices?.[0]?.delta?.content||'';
      const finish=e.choices?.[0]?.finish_reason;
      if(finish&&finish!=='stop')throw new ProviderError('incomplete',`生成未完整结束（${finish}），请重试`);
      if(finish==='stop')complete=true;
     }
     if(text){got=true;yield text;}
    }
   }catch(e){if(e.name==='AbortError'||e instanceof ProviderError)throw e;throw new ProviderError('network','生成连接中断，已保留收到的部分');}
   if(!got)throw new ProviderError('empty','模型没有返回文字，请检查模型是否支持文字生成');
   if(!complete)throw new ProviderError('incomplete','连接提前结束，收到的内容可能不完整');
  }
 };
}
export const providers={gemini,
 openai:adapter('openai','OpenAI','https://api.openai.com/v1','responses'),
 anthropic:adapter('anthropic','Anthropic Claude','https://api.anthropic.com/v1','anthropic'),
 deepseek:adapter('deepseek','DeepSeek','https://api.deepseek.com','chat'),
 moonshot:adapter('moonshot','Moonshot / Kimi（国内）','https://api.moonshot.cn/v1','chat'),
 moonshot_global:adapter('moonshot_global','Moonshot / Kimi（国际）','https://api.moonshot.ai/v1','chat'),
 zai:adapter('zai','Z.ai（国际）','https://api.z.ai/api/paas/v4','chat'),
 zhipu:adapter('zhipu','智谱 BigModel（国内）','https://open.bigmodel.cn/api/paas/v4','chat'),
 openrouter:adapter('openrouter','OpenRouter（聚合服务）','https://openrouter.ai/api/v1','chat'),
};
