// Read-only bridge for the pre-cloud version. Never writes or deletes local records.
export function readLegacyControl(){
 if(typeof indexedDB==='undefined')return Promise.resolve(null);
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('meu-dinheiro-local-v1');let created=false;
  request.onupgradeneeded=()=>{created=true;request.transaction.abort();};
  request.onerror=()=>created?resolve(null):reject(new Error('Não foi possível ler o controle antigo. Use seu backup JSON.'));
  request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('control')){db.close();resolve(null);return;}
   const tx=db.transaction('control','readonly'),query=tx.objectStore('control').get('current');let result=null;
   query.onsuccess=()=>{result=query.result||null;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(new Error('Não foi possível ler o controle antigo. Use seu backup JSON.'));};
  };
 });
}
