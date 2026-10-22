import {validateState} from './finance.mjs';

const LIMIT=2_000_000,CHARS=120_000,MAX_PARTS=64;
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const corrupt=()=>new Error('O controle online está incompleto ou falhou na verificação de integridade. Nenhum dado foi alterado.');
function descriptorValid(d){return d&&Number.isSafeInteger(d.revision)&&d.revision>0&&Number.isInteger(d.parts)&&d.parts>0&&d.parts<=MAX_PARTS&&Number.isInteger(d.bytes)&&d.bytes>0&&d.bytes<=LIMIT&&/^[a-f0-9]{64}$/.test(d.hash)&&typeof d.updatedAt==='string';}
async function encode(state){
 validateState(state);const text=JSON.stringify(state),bytes=new TextEncoder().encode(text).byteLength;
 if(bytes>LIMIT)throw new Error('O controle excede o limite de tamanho de 2 MB. Exporte um backup e revise os dados antes de continuar.');
 const chunks=[];for(let start=0;start<text.length;){let end=Math.min(start+CHARS,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push(text.slice(start,end));start=end;}
 return {chunks,hash:await digest(text),bytes};
}
async function readVersion(tx,prefix,descriptor){
 if(!descriptorValid(descriptor))throw corrupt();
 const parts=await Promise.all(Array.from({length:descriptor.parts},(_,i)=>tx.get(`${prefix}-${i}`)));
 if(parts.some(p=>!p||typeof p.data!=='string'||p.data.length>CHARS))throw corrupt();
 const text=parts.map(p=>p.data).join('');
 if(new TextEncoder().encode(text).byteLength!==descriptor.bytes||await digest(text)!==descriptor.hash)throw corrupt();
 let state;try{state=JSON.parse(text);validateState(state);}catch{throw corrupt();}
 return {state,revision:descriptor.revision,updatedAt:descriptor.updatedAt};
}
function headValid(head){if(head&&(head.schema!==1||!descriptorValid(head.current)||head.previous!==null&&!descriptorValid(head.previous)))throw corrupt();}

// driver.transaction always contacts the server; there is no local fallback.
export function createCloudStore(driver){
 return {
  readControl:()=>driver.transaction(async tx=>{const head=await tx.get('head');headValid(head);return head?readVersion(tx,'current',head.current):null;}),
  previousControl:()=>driver.transaction(async tx=>{const head=await tx.get('head');headValid(head);return head?.previous?readVersion(tx,'previous',head.previous):null;}),
  async writeControl(state,revision){
   if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Revisão inválida. Recarregue os dados da nuvem.');
   const packed=await encode(state),operationId=await digest(`${revision}:${packed.hash}`),next={revision:revision+1,updatedAt:new Date().toISOString(),parts:packed.chunks.length,hash:packed.hash,bytes:packed.bytes};
   return driver.transaction(async tx=>{
    const head=await tx.get('head');headValid(head);
    if(head?.current.revision===revision+1&&head.lastOperationId===operationId)return readVersion(tx,'current',head.current);
    if((head?.current.revision||0)!==revision)throw new Error('O controle mudou em outro aparelho. Recarregue os dados antes de salvar; seu formulário foi mantido.');
    let oldParts=[];
    if(head){await readVersion(tx,'current',head.current);oldParts=await Promise.all(Array.from({length:head.current.parts},(_,i)=>tx.get(`current-${i}`)));}
    for(const [i,data]of packed.chunks.entries())tx.set(`current-${i}`,{data});
    for(let i=packed.chunks.length;i<(head?.current.parts||0);i++)tx.delete(`current-${i}`);
    for(const [i,value]of oldParts.entries())tx.set(`previous-${i}`,value);
    for(let i=oldParts.length;i<(head?.previous?.parts||0);i++)tx.delete(`previous-${i}`);
    tx.set('head',{schema:1,current:next,previous:head?.current||null,lastOperationId:operationId});
    return {state:JSON.parse(packed.chunks.join('')),revision:next.revision,updatedAt:next.updatedAt};
   });
  }
 };
}
